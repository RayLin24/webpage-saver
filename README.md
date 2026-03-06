# WebPage Saver

将任意网页保存为单个HTML文件的纯前端工具。

## 功能特点

- 🔗 输入URL，一键保存网页
- 📦 所有资源内联（CSS、图片、字体）
- 🌐 完全离线可用
- 💾 生成单个HTML文件
- 🎨 保持原网页样式

## 技术方案

- 纯前端实现（HTML + CSS + JavaScript）
- 使用CORS代理解决跨域问题
- 将资源转换为Data URI内联

## 使用方法

1. 打开 `index.html`
2. 输入网页URL
3. 点击"保存"按钮
4. 下载生成的HTML文件

## 注意事项

- 需要CORS代理支持
- 部分动态内容可能无法完美保存
- JavaScript执行的内容需要特殊处理
