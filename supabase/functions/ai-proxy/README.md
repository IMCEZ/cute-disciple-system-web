# ai-proxy 部署指南（Supabase Edge Function）

## 这个东西是干什么的

APK 里的页面是跑在 Android WebView 里的。WebView 发 POST 请求时会用
`Transfer-Encoding: chunked` 且不带 `Content-Length`，很多中转站读不到 body 长度，
直接返回 `HTTP 400 invalid JSON request body`。

这个 Edge Function 就是一个「中间人」：

```
APP(WebView)  ──HTTPS──▶  ai-proxy(Supabase)  ──标准HTTP──▶  AI服务/中转站
```

Supabase 用标准 HTTP 转发（天然带 Content-Length），绕开 chunked 问题。
它**不存任何数据**，只做转发，API Key、聊天记录全部留在用户手机本地。

**地址随用户走**：转发目标由 APP 里「协议 + API 地址」决定，代码里没写死任何地址。
- 用户选 OpenAI 且地址留空 → 转发到 `api.openai.com`
- 用户选 Claude 且地址留空 → 转发到 `api.anthropic.com`
- 用户选 Gemini 且地址留空 → 转发到 Google 官方
- 用户填了某个中转站 → 转发到那个中转站

一次部署，永久通用，用户换什么 API 都不用再改这个函数。

---

## 一次性准备（约 10 分钟）

### 第 1 步：注册 Supabase 账号

1. 打开 https://supabase.com
2. 点右上角 **Sign in** → 用 GitHub 或邮箱注册（免费，无需备案、无需信用卡）

### 第 2 步：创建一个项目

1. 登录后进入控制台，点 **New project**
2. 填写：
   - **Name**：随便起，例如 `disciple-proxy`
   - **Database Password**：随便设一个强密码（这个代理用不到数据库，但创建项目时必须填，记下来即可）
   - **Region**：选离你/用户近的，例如 `Southeast Asia (Singapore)`
3. 点 **Create new project**，等 1~2 分钟初始化完成

### 第 3 步：记下 Project Ref（项目标识）

1. 进入项目后，左下角点齿轮 **Project Settings**
2. 点 **General**
3. 找到 **Reference ID**（也叫 project-ref），形如 `abcdefghijklmnop`
4. 复制记下，后面要用

---

## 部署函数（在你的电脑上操作）

> 需要电脑装了 Node.js。Windows / Mac / Linux 都行。

### 第 1 步：安装 Supabase CLI

打开终端（Windows 用 PowerShell 或 CMD），执行：

```bash
npm i -g supabase
```

验证装好：

```bash
supabase --version
```

能打印出版本号就 OK。

### 第 2 步：登录

```bash
supabase login
```

会自动打开浏览器让你授权，点同意后回到终端，会显示登录成功。

### 第 3 步：进入项目目录

把整个 `web new` 项目拷到电脑上，然后 cd 进去。注意目录名有空格，要用引号：

```bash
cd "web new"
```

确认目录里有 `supabase/functions/ai-proxy/index.ts` 这个文件：

```bash
# Windows
dir supabase\functions\ai-proxy
# Mac/Linux
ls supabase/functions/ai-proxy
```

### 第 4 步：关联到你的 Supabase 项目

把 `<你的project-ref>` 换成第 3 步记下的 Reference ID：

```bash
supabase link --project-ref <你的project-ref>
```

可能会让你输入数据库密码（就是创建项目时设的那个），输入即可。

### 第 5 步：部署

```bash
supabase functions deploy ai-proxy --no-verify-jwt
```

> `--no-verify-jwt` 很关键：让这个函数公开可访问，APP 不需要带登录 token。

部署成功后终端会显示函数地址，形如：

```
https://<你的project-ref>.supabase.co/functions/v1/ai-proxy
```

**把这个地址复制下来。**

---

## 验证部署成功（可选但推荐）

在终端跑下面这条（把地址换成你自己的）。这里故意用假 key，
预期返回的是鉴权类错误（如 `401`），**只要不是 `400 invalid JSON` 就说明代理链路通了**：

```bash
curl -X POST "https://<你的project-ref>.supabase.co/functions/v1/ai-proxy/api/ai/models" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"openai\",\"apiUrl\":\"https://api.openai.com\",\"apiKey\":\"sk-test\"}"
```

- 返回 `{"error":"HTTP 401: ..."}` → 正常，代理把请求送到了 OpenAI，只是 key 是假的
- 返回 `{"models":[...]}` → 如果你填了真 key，会直接列出模型
- 连不上 / 超时 → 检查函数是否部署成功、地址是否写对

---

## 在 APP 里配置（最后一步）

1. 打开 APP，进 **设置 → API 连接**
2. 找到 **后端代理地址** 输入框
3. 填入你的函数地址（**不要带结尾斜杠**）：
   ```
   https://<你的project-ref>.supabase.co/functions/v1/ai-proxy
   ```
4. 下方正常填 **协议 / API 地址 / API Key / 模型名**（你自己的 AI 配置）
5. 点 **保存设置**
6. 点 **测试连接**，通了就说明整条链路成功

之后所有 AI 请求都会经 Supabase 代理转发，不再出现 400 / 挂起。
APK 装到任何手机上，只要填好这个代理地址就能用，不依赖你电脑上的本地后端。

---

## 常见问题

**Q：免费额度够用吗？**
够。Supabase Edge Functions 免费版每月 50 万次调用，个人使用远远用不完。

**Q：以后换了 AI 服务商 / 中转站，要重新部署吗？**
不用。代理只按 APP 传来的「协议 + 地址」转发，换服务商只在 APP 设置里改 API 地址即可。

**Q：改了 index.ts 怎么更新？**
重新跑一次 `supabase functions deploy ai-proxy --no-verify-jwt` 即可覆盖。

**Q：会泄露我的 API Key 吗？**
API Key 由 APP 直接发给代理再转发给上游，代理不落盘、不记录。但代理服务器理论上能看到经手的 Key，
如果特别敏感，建议用自己完全掌控的 Supabase 项目（本方案就是），不要用他人共享的代理地址。

**Q：本地开发时不想每次都连 Supabase？**
把 `backend/` 里的本地 Node 后端跑起来（`cd backend && node server.js`），
APP 设置里「后端代理地址」留空即可自动回退到 `http://localhost:3001`。
