# tencentcloud-autoexpand

一个 Hydro 插件，用于在评测队列过于拥挤的时候自动创建评测机。

## 一、在腾讯云创建子账户

进入 [腾讯云控制台](https://console.cloud.tencent.com/cam/user/create?systemType=FastCreateV2)，创建一个拥有 AdministratorAccess 权限的子账户，确保打开“编程访问”选项。

![](https://img.zshfoj.com/8f511964f0ba835b7bcdcc3cc85d25715cd52f9d7fffb1b2092fed25e0f5fd62.png)

创建账号后，将 SecretId 与 SecretKey 复制下来，保存在电脑上（不要发给其他人）。

![](https://img.zshfoj.com/d6413f9a6cd6ec7dcf942f6609ec32e48654dbf85fcdf6e70d71b8761a1bd605.png)

## 二、下载并安装本插件

在安装 Hydro Web 服务器上执行 `git clone https://github.com/StupidQu/tencentcloud-autoexpand.git` 下载本插件，然后通过 `cd tencentcloud-autoexpand && yarn install` 安装插件依赖，最后通过 `hydrooj addon add /<你执行 git clone 的目录>/tencentcloud-autoexpand` 添加本插件。

## 三、创建服务器启动模板

进入 [腾讯云 CVM 控制台](https://console.cloud.tencent.com/cvm/overview)，点击左侧“实例启动模板”，点击新建模板。

![](https://img.zshfoj.com/e9d51b46d49b0d16e0cd285865eda6d90b27971d80bac1949d707ff083f68b40.png)

在新建模板界面选择你需要的服务器配置（推荐选择按量付费或竞价计费），务必勾选这里的“自动化助手”。

![](https://img.zshfoj.com/42012b3b885b0fdc1bb0a5562753df06ff52705714d3f414d442d0c0f8b64f7a.png)

创建模板后，记录下这里的模板 ID 与版本（如果你是新建模板则为 1）。

![](https://img.zshfoj.com/5ae256372ccfc1d9e51f09c74d1cebf240447ffb4d3a904498f8c6c28bc1aa80.png)

## 四、配置插件

使用你喜欢的编辑器编辑插件里的 `index.ts` 文件，你需要更改变量 `JudgeConfig` 与 `CONFIG`。

![](https://img.zshfoj.com/29764f1c6a34753e3ba629efe992e89d13ccbfdb61f9eb3711f0b25b341057dd.png)

![](https://img.zshfoj.com/70513e2b367290c61d48b817bb539eb9c5385cab1ef372573695b07830fa62d9.png)

## 五、重启 Hydro

此时重启 Hydro，插件就会按照配置生效。
