# WebPage Saver 🌐

一个强大的纯前端网页保存工具，可以将任意网页保存为单个 HTML 文件，支持历史记录、预览和下载。

[![在线使用](https://img.shields.io/badge/在线使用-webpage--saver.vercel.app-blue)](https://webpage-saver.vercel.app)
[![GitHub](https://img.shields.io/badge/GitHub-RayLin24/webpage--saver-black)](https://github.com/RayLin24/webpage-saver)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## ✨ 功能特点

### 核心功能

- 🔗 **URL 保存** - 输入网址，一键保存完整网页
- 📁 **本地文件上传** - 支持上传本地 HTML 文件处理
- 📦 **资源内联** - 自动将 CSS、图片、字体转换为 base64 内联
- 💾 **单个文件** - 生成单个独立的 HTML 文件，无需网络即可查看

### 历史记录

- 📚 **自动保存** - 所有保存的网页自动记录到历史
- 🔍 **搜索功能** - 支持按标题或 URL 搜索历史记录
- 👁️ **预览功能** - 模态框预览保存的网页内容
- 📥 **随时下载** - 可从历史记录随时重新下载

### 特殊支持

- 📱 **微信公众号** - 集成 [wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter) API
- 🔓 **解除复制限制** - 自动移除网页的复制、选择、右键限制
- 🌐 **CORS 代理** - 自动处理跨域请求

## 🚀 使用方法

### 在线使用

直接访问：**https://webpage-saver.vercel.app**

### 本地运行

```bash
# 克隆仓库
git clone https://github.com/RayLin24/webpage-saver.git
cd webpage-saver

# 使用任意 HTTP 服务器运行
python -m http.server 8080
# 或
npx serve .
```

然后打开 `http://localhost:8080`

## 📖 使用指南

### 方式一：URL 保存

1. 输入网页 URL（如 `https://example.com`）
2. 选择保存选项
3. 点击"开始保存"
4. 自动下载 HTML 文件

### 方式二：上传本地文件

1. 点击或拖拽上传 HTML 文件
2. 点击"开始保存"处理
3. 下载处理后的文件

### 保存选项

| 选项 | 说明 |
|------|------|
| 内联图片 | 将图片转换为 base64 内联 |
| 内联 CSS | 将外部 CSS 内联到 HTML |
| 内联字体 | 将字体文件内联 |
| 移除 JS | 移除所有 JavaScript |
| 解除复制限制 | 解除网页的复制和选择限制 |

## 🔧 技术实现

### 架构

```
纯前端实现（无需后端）
├── HTML5 + CSS3 + Vanilla JavaScript
├── IndexedDB 存储历史记录
├── CORS 代理解决跨域
└── Vercel 静态部署
```

### CORS 代理

使用多个 CORS 代理确保可用性：

1. `api.codetabs.com` - 主要代理
2. `api.allorigins.win` - 备用代理
3. `corsproxy.io` - 备用代理

### 微信公众号支持

集成 [wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter) 的公开 API：

```
GET https://down.mptext.top/api/public/v1/download?url=<文章URL>&format=html
```

## ⚠️ 注意事项

### 支持的网站

| 网站类型 | 支持程度 | 备注 |
|----------|----------|------|
| 普通网站 | ✅ 完美 | 大部分网站都能正常保存 |
| 微信公众号 | ✅ 支持 | 使用专用 API |
| 需要登录的网站 | ⚠️ 需配合 SingleFile | 见下方说明 |
| CDN 防盗链网站 | ⚠️ 图片可能失败 | 见下方说明 |

### 需要登录的网站

对于需要登录的网站，推荐使用 **SingleFile** 浏览器扩展：

1. 安装 [SingleFile](https://chrome.google.com/webstore/detail/singlefile/)
2. 登录网站后，使用 SingleFile 保存
3. 将保存的 HTML 上传到本工具进一步处理

### CDN 防盗链图片

部分网站使用 CDN 防盗链（如 `pic.code-nav.cn`），公共代理无法访问：

- **推荐方案**：使用 SingleFile 扩展保存
- **替代方案**：保存后手动下载图片

## 🛠️ 开发

### 项目结构

```
webpage-saver/
├── index.html          # 主页面
├── main.js             # 主要逻辑
├── vercel.json         # Vercel 配置
├── test.html           # 测试页面
└── README.md           # 说明文档
```

### 本地开发

```bash
# 安装依赖（可选，用于测试）
npm install -g serve

# 运行开发服务器
serve . -p 8080
```

## 📝 更新日志

### v1.0.0 (2026-03-07)

- ✅ 基础网页保存功能
- ✅ 历史记录（IndexedDB）
- ✅ 预览和下载
- ✅ 上传本地文件
- ✅ 微信公众号支持
- ✅ 解除复制限制
- ✅ 并行图片处理（10 并发）
- ✅ 存储空间统计

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

[MIT License](LICENSE)

## 🙏 致谢

- [SingleFile](https://github.com/gildas-lormeau/SingleFile) - 灵感来源
- [wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter) - 微信文章 API
- [allorigins](https://allorigins.win/) - CORS 代理
- [codetabs](https://api.codetabs.com) - CORS 代理

---

⭐ 如果这个项目对你有帮助，欢迎 Star！
