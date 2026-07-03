# PDF 分割工具

一个完全在浏览器本地处理文件的中文 PDF 分割 PWA，适用于 macOS 和 iPhone。

- 在线工具：https://pdf-splitter-kesheng.pages.dev
- GitHub：https://github.com/Kkri2024/pdf-splitter-pwa

## 功能

- 每 N 页分割一份
- 一键逐页分割
- 自定义范围分割，例如 `1-3,5,8-10`
- 页面缩略图预览
- 单个 PDF 分享或保存
- 全部结果打包为 ZIP
- 安装到主屏幕后离线使用

选择的 PDF 不会上传，也不会保存在服务器或浏览器历史中。

## 本地运行

```bash
npm install
npm run dev
```

浏览器访问终端显示的本地地址。

## 检查

```bash
npm test
npm run build
```

## 发布到 Cloudflare Pages

1. 创建公开 GitHub 仓库，并将本项目推送到 `main` 分支。
2. 在 Cloudflare Pages 中选择 **连接到 Git**，授权并选择该 GitHub 仓库。
3. 生产分支选择 `main`，构建命令填写 `npm run build`，输出目录填写 `dist`。
4. 完成连接后，每次推送到 `main` 都会自动构建并发布。

如需从本机执行一次备用发布，可运行：

```bash
npm run deploy:cloudflare
```

Cloudflare 登录信息和 API 密钥不会保存在代码仓库中。
