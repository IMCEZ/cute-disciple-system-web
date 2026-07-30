# 可爱徒弟系统 · Web

静态前端部署在 Vercel，Supabase 提供邮箱魔法链接、Discord OAuth、云端存档和受认证保护的 AI 请求代理。

生产站点：<https://cute-disciple-system-web.vercel.app>

## 隐私边界

游戏存档会按登录用户同步到 Supabase。AI 服务地址、模型和 API Key 仅保存在当前浏览器的本地存储，云端不会保存或记录它们。

## 首次部署配置

1. 在 Supabase Auth 中设置 Site URL 与允许的 Redirect URL 为 Vercel 站点地址。
2. 启用 Email（Magic Link）登录。
3. 在 Discord Developer Portal 的 OAuth2 Redirects 添加 `https://<project-ref>.supabase.co/auth/v1/callback`，再把 Discord Client ID / Secret 填入 Supabase 的 Discord Provider。
4. 部署 Edge Function `ai-proxy` 时保持 JWT 验证开启。

本地预览：`npx serve .`
