# PDF 分割工具

一个完全在浏览器本地处理文件的中文 PDF 分割 PWA，适用于 macOS 和 iPhone。

- 在线工具：https://pdf-splitter-tool.pages.dev
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


## 源码与发布维护（2026-10-08）

- 本地目录：`/Users/kesheng/Documents/Codex项目/代码项目/PDF分割工具`。源码需完整下载，不能只保留云端占位文件。
- GitHub： https://github.com/Kkri2024/pdf-splitter-pwa ，生产分支 `main`。
- 正式入口： https://pdf-splitter-tool.pages.dev
- 发布方式：Cloudflare Pages Git 集成。检查失败不发布；推送 `main` 后检查 GitHub 和 Cloudflare 结果。
- 本地安装：`npm ci`；检查：`npm test`；构建：`npm run build`。
- 本地预览：构建后用 HTTP 服务访问产物；不要双击 HTML。原有开发命令继续可用。
- 回滚：对发布提交执行 `git revert` 并推送 `main`；紧急情况下先在 Cloudflare 恢复上一有效部署，随后同步 GitHub，避免下一次推送覆盖回退。
- 密钥与环境文件不提交。部署凭据仅保存在 GitHub Secrets；不要将浏览器 API Key 写入模型目录。

## 图片拼接

“图片拼接”工作区支持多张 JPG、PNG、静态 WebP，在本设备完成纵向长图、横向拼接及 2～4 列网格拼图。可调整顺序、裁剪原图边缘、旋转、设置间距/留白/背景并撤销编辑；默认完整保留内容。导出 PNG 或 JPG，过长的图片可分段并打包下载 ZIP。

- 单张导入上限 25 MB、4000 万像素，当前图片合计最多 120 MB。
- 单张导出上限 8192 像素边长、1600 万像素；超过限制可减小尺寸或开启分段。分段可能切开图片内容。
- 不支持 HEIC 或动态图片；不自动识别截图重叠部分。
- 原图、编辑和生成结果只保留在当前页面，刷新后消失；生成后请下载保存。
- 系统分享依赖浏览器支持，不支持时可下载后分享。

本地验收记录：`qa/image-stitch/REPORT.md`。

## 图片转 PDF、图片压缩与转换

- 图片转 PDF：多张 JPG、PNG、静态 WebP 按当前顺序生成 PDF，每张一页；支持前移/后移、旋转、移除、页面预览、A4/原图尺寸、横竖版和 0～30 mm 边距。清晰优先使用 PNG，较小体积使用 JPG；最长边最多 4096 像素，单张处理最多 1600 万像素。此功能不会识别图片文字。
- 图片压缩与转换：批量导出 JPG、PNG、WebP；按最长边等比缩小，不放大小图。JPG/WebP 可调清晰度，PNG 不使用清晰度压缩。PNG/WebP 保留透明区域，JPG 填为白色。结果显示实际尺寸、体积和相对原图的增减；转换不保证文件变小。
- 新工具一次最多 100 张，单张导入最多 25 MB、4000 万像素，总输入及结果分别最多 120 MB；输出单张最多 8192 像素边长、1600 万像素。不支持 HEIC 和动态图片。
- 结果可直接进入其他工具：分割结果加入 PDF 合并、PDF 结果转图后拼接/压缩、拼接结果转 PDF/压缩、转换图片转 PDF/拼接、图片生成的 PDF 加入合并。图片接续会追加到目标列表，保留已有内容。PDF 转图接续一次最多 100 页、120 MB；目标工具仍会逐个校验文件并报告未导入的文件。
- 各工具内容仅在当前页面保留，刷新后消失；生成后请下载保存。所有处理均在本设备完成。

本地验收记录：`qa/image-tools/REPORT.md`。
