// 注意：该插件会产生费用，用于当评测队列过于拥挤时，自动扩容评测队列。

import { Logger, RecordModel, STATUS, fs, sleep, yaml } from 'hydrooj';
const tencentcloud = require('tencentcloud-sdk-nodejs');

const logger = new Logger('auto-expand');

// 评测机的评测设置
const JudgeConfig = {
  hosts: {
    local: {
      host: 'localhost',
      type: 'hydro',
      server_url: '', // 更改为你的 Hydro URL
      uname: 'judge', // 创建一个具有 PRIV_JUDGE 权限的用户，填写他的用户名
      password: '', // 填写密码
      detail: true,
    },
  },
  tmpfs_size: '512m',
  stdio_size: '128m',
  memoryMax: '1024m',
  testcases_max: 120,
  total_time_limit: 600,
  retry_delay_sec: 3,
  parallelism: 1,
  singleTaskParallelism: 2,
  rate: 1.00,
  rerun: 2,
  secret: 'Hydro-Judge-Secret',
  env: 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\nHome=/w',
};

// 请填写如下配置信息：
const CONFIG = {
  TCSecretId: '', // 腾讯云子账户 SecretId
  TCSecretKey: '', // 腾讯云子账户 SecretKey
  TCRegion: 'ap-shanghai', // 启动模板服务器所在地域

  CVMLaunchTemplate: { // 启动模板信息
    LaunchTemplateId: '', // 启动模板ID
    LaunchTemplateVersion: 0, // 启动模板版本 (数字)
  },
  /*
  付费方式：
  POSTPAID_BY_HOUR：按小时后付费
  SPOTPAID：竞价付费
  */
  CVMInstanceChargeType: 'SPOTPAID',

  ServersSavePath: 'servers.json', // 将实例信息保存在哪个文件中，请不要直接更改这个文件

  // 如果持续 ExpandIfDuration 秒内都有大于 ExpandIfWaitingTasksMoreThan 条评测在等待中，并且上次扩容在至少 ExpandIfSinceLast 秒前，则自动扩容 ExpandCount 台服务器
  ExpandIfDuration: 5 * 60,
  ExpandIfWaitingTasksMoreThan: 5,
  ExpandIfSinceLast: 10 * 60,
  ExpandCount: 1,

  // 如果持续 ReleaseIfDuration 秒内等待评测的数量都小于 ReleaseIfWaitingTasksLessThan，并且上次释放在至少 ReleaseIfSinceLast 秒前，则自动释放 ReleaseCount 台服务器
  // 注意：一台服务器只有在计费周期（一小时）的后 5 分钟内才有可能会释放（即：如果一台服务器刚开 10 分钟就满足了这个释放的条件，此时其也不会被释放）
  ReleaseIfDuration: 5 * 60,
  ReleaseIfWaitingTasksLessThan: 2,
  ReleaseIfSinceLast: 10 * 60,
  ReleaseCount: 1,

  InstallCommands: [ // 安装评测机所用的命令，如无必要无需更改这部分内容
    'apt install curl',
    '. <(curl https://hydro.ac/setup.sh) --judge',
    `echo -e ${JSON.stringify(yaml.dump(JudgeConfig))} > ~/.hydro/judge.yaml`,
    'pm2 start hydrojudge && pm2 save',
  ]
};

type Server = {
  instanceId: string;
  createdAt: number;
};

const client = new tencentcloud.cvm.v20170312.Client({
  credential: {
    secretId: CONFIG.TCSecretId,
    secretKey: CONFIG.TCSecretKey,
  },
  region: CONFIG.TCRegion,
  profile: {
    httpProfile: {
      endpoint: 'cvm.tencentcloudapi.com',
    },
  },
});

const tatClient = new tencentcloud.tat.v20201028.Client({
  credential: {
    secretId: CONFIG.TCSecretId,
    secretKey: CONFIG.TCSecretKey,
  },
  region: CONFIG.TCRegion,
  profile: {
    httpProfile: {
      endpoint: 'tat.tencentcloudapi.com',
    },
  },
});

const serversPool = new Map<string, Server>();
let lastReleaseAt = 0;
let creating = false, releasing = false;

// 这个函数创建一个新的服务器实例，默认创建一台，加入到服务器池中
async function addInstance(serverCount = 1) {
  if (creating) return;
  creating = true;
  const data = await client.RunInstances({
    InstanceChargeType: CONFIG.CVMInstanceChargeType,
    InstanceCount: serverCount,
    LaunchTemplate: {
      LaunchTemplateId: CONFIG.CVMLaunchTemplate.LaunchTemplateId,
      LaunchTemplateVersion: CONFIG.CVMLaunchTemplate.LaunchTemplateVersion,
    }
  });
  data.InstanceIdSet.forEach((i) => serversPool.set(i, { instanceId: i, createdAt: Date.now() }));
  creating = false;
  return data;
}

async function releaseInstance(InstanceIds: string[]) {
  if (InstanceIds.length === 0) return;
  if (releasing) return;
  releasing = true;
  lastReleaseAt = Date.now();
  logger.info(`实例空闲过多，正在释放实例 ${InstanceIds.join(' ')}.`)
  await client.TerminateInstances({
    InstanceIds,
  });
  InstanceIds.forEach((i) => serversPool.delete(i));
  releasing = false;
}

async function installServerFor(InstanceIds) {
  logger.info(`正在为 ${InstanceIds.join(' ')} 安装评测机。`)
  const commandBase64 = Buffer.from(CONFIG.InstallCommands.join('\n')).toString('base64');
  let retry = 0;
  try {
    if (retry < 10) {
      const data = await tatClient.RunCommand({
        Content: commandBase64,
        InstanceIds,
        Timeout: 180,
      });
      return data;
    }
  } catch (e) {
    retry++;
    logger.error(e);
    await sleep(90 * 1000);
    return installServerFor(InstanceIds);
  }
}

const waitingCount = [];

function isNeedExpand() {
  let lastExpandedAt = Math.max(...Array.from(serversPool.values()).map(i => i.createdAt));
  const minWaitingCount = Math.min(...[Number.MAX_SAFE_INTEGER, ...waitingCount.slice(Math.max(0, waitingCount.length - CONFIG.ExpandIfDuration), -1)]);
  return (Date.now() > lastExpandedAt + CONFIG.ExpandIfSinceLast * 1000) && (minWaitingCount > CONFIG.ExpandIfWaitingTasksMoreThan);
}

function getServersToRelease(): string[] {
  if (Date.now() < lastReleaseAt + CONFIG.ReleaseIfSinceLast * 1000) return [];
  const maxWaitingCount = Math.max(...[0, ...waitingCount.slice(Math.max(0, waitingCount.length - CONFIG.ExpandIfDuration), -1)]);
  if (maxWaitingCount >= CONFIG.ReleaseIfWaitingTasksLessThan) return [];
  return Array.from(serversPool.values())
    .filter((server) => (Date.now() - server.createdAt) % 60 * 60 * 1000 > 55 * 60 * 1000) // 服务器只有在被创建 55 分钟后才可能会被释放
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, CONFIG.ReleaseCount)
    .map((i) => i.instanceId);
}

function loadServers() {
  // 将保存在文件中的所有服务器信息读取出来
  if (!fs.existsSync(CONFIG.ServersSavePath)) return;
  const serversText = fs.readFileSync(CONFIG.ServersSavePath).toString();
  const serversData = JSON.parse(serversText);
  const servers: Server[] = serversData['servers'];
  lastReleaseAt = serversData['lastReleaseAt'];
  servers.forEach((server) => {
    serversPool.set(server.instanceId, server);
  }); // 将读取出来的服务器信息加入到服务器池中
}

function autoExpandAndRelease() {
  // 这个函数用于设置一个定时器，自动扩容和释放服务器
  const intervalId = setInterval(async () => {
    const recordsInWaiting = await RecordModel.coll.countDocuments({ status: STATUS.STATUS_WAITING });
    waitingCount.push(recordsInWaiting);
    if (waitingCount.length > Math.max(CONFIG.ExpandIfDuration, CONFIG.ReleaseIfDuration)) waitingCount.shift();

    if (isNeedExpand()) {
      logger.info(`在 ${CONFIG.ExpandIfDuration} 秒内有多于 ${CONFIG.ExpandIfWaitingTasksMoreThan} 条等待中的记录，正在执行自动扩容。`);
      const data = await addInstance(CONFIG.ExpandCount); // 执行自动扩容
      logger.info(`创建的实例 ID: ${data.InstanceIdSet.join(' ')}.`);
      setTimeout(() => installServerFor(data.InstanceIdSet), 90 * 1000); // 保证自动化助手安装了
    }
    await releaseInstance(getServersToRelease()); // 执行自动释放

    fs.writeFileSync(CONFIG.ServersSavePath, JSON.stringify({ servers: Array.from(serversPool.values()), lastReleaseAt }))
  }, 1000);
  return intervalId;
}

export async function apply() {
  loadServers();
  autoExpandAndRelease();

  logger.info('Auto expand service started. Make sure you have enough balance in your account.');
}
