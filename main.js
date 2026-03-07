/**
 * WebPage Saver - 网页保存工具
 * 优化版本
 */

class StorageManager {
    constructor() {
        this.dbName = 'WebPageSaverDB';
        this.dbVersion = 1;
        this.storeName = 'pages';
        this.db = null;
    }
    
    async init() {
        if (navigator.storage?.persist) {
            await navigator.storage.persist();
        }
        
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('savedAt', 'savedAt', { unique: false });
                }
            };
        });
    }
    
    async add(item) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('DB未初始化'));
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.add(item);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    async delete(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    async get(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    async getAll() {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve([]);
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('savedAt');
            const request = index.openCursor(null, 'prev');
            const results = [];
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
    
    async clear() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    async getStorageInfo() {
        if (navigator.storage?.estimate) {
            const estimate = await navigator.storage.estimate();
            return { usage: estimate.usage || 0, quota: estimate.quota || 0 };
        }
        const all = await this.getAll();
        let totalSize = 0;
        for (const item of all) {
            if (item.content) totalSize += new Blob([item.content]).size;
        }
        return { usage: totalSize, quota: 10 * 1024 * 1024 };
    }
}

class WebPageSaver {
    constructor() {
        this.urlInput = document.getElementById('url');
        this.saveBtn = document.getElementById('saveBtn');
        this.statusDiv = document.getElementById('status');
        this.progressDiv = document.getElementById('progress');
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');
        this.historyList = document.getElementById('historyList');
        this.historyCount = document.getElementById('historyCount');
        this.searchInput = document.getElementById('searchInput');
        this.clearAllBtn = document.getElementById('clearAllBtn');
        this.storageSize = document.getElementById('storageSize');
        this.previewModal = document.getElementById('previewModal');
        this.previewFrame = document.getElementById('previewFrame');
        this.previewTitle = document.getElementById('previewTitle');
        this.toast = document.getElementById('toast');
        
        // 文件上传相关元素
        this.fileInput = document.getElementById('fileInput');
        this.fileUploadArea = document.getElementById('fileUploadArea');
        this.fileSelected = document.getElementById('fileSelected');
        this.fileName = document.getElementById('fileName');
        this.removeFileBtn = document.getElementById('removeFile');
        this.selectedFile = null;
        
        this.currentPreviewItem = null;
        this.storage = new StorageManager();
        
        // 多个 CORS 代理，按可用性排序
        this.corsProxies = [
            'https://api.codetabs.com/v1/proxy/?quest=',
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?'
        ];
        
        this.currentProxyIndex = 0;
        this.resourceCache = new Map();
        this.stats = { imagesProcessed: 0, imagesSuccess: 0, imagesFailed: 0 };
        
        this.init();
    }
    
    async init() {
        try {
            await this.storage.init();
        } catch (e) {
            console.error('存储初始化失败:', e);
        }
        
        // URL 保存按钮
        this.saveBtn.addEventListener('click', () => this.save());
        
        // URL 输入框回车
        this.urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.save();
        });
        
        // 搜索功能
        this.searchInput.addEventListener('input', () => this.renderHistory());
        
        // 清空历史
        this.clearAllBtn.addEventListener('click', () => this.clearAllHistory());
        
        // 预览模态框事件
        document.getElementById('closeModal').addEventListener('click', () => this.closePreview());
        document.getElementById('closePreviewBtn').addEventListener('click', () => this.closePreview());
        document.getElementById('downloadFromPreview').addEventListener('click', () => this.downloadFromPreview());
        
        this.previewModal.addEventListener('click', (e) => {
            if (e.target === this.previewModal) this.closePreview();
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closePreview();
        });
        
        // 文件上传事件
        this.initFileUpload();
        
        await this.renderHistory();
        await this.updateStorageInfo();
    }
    
    // 初始化文件上传功能
    initFileUpload() {
        // 点击上传区域
        this.fileUploadArea.addEventListener('click', () => {
            this.fileInput.click();
        });
        
        // 文件选择
        this.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileSelect(e.target.files[0]);
            }
        });
        
        // 移除文件
        this.removeFileBtn.addEventListener('click', () => {
            this.clearSelectedFile();
        });
        
        // 拖拽上传
        this.fileUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.fileUploadArea.classList.add('dragover');
        });
        
        this.fileUploadArea.addEventListener('dragleave', () => {
            this.fileUploadArea.classList.remove('dragover');
        });
        
        this.fileUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.fileUploadArea.classList.remove('dragover');
            
            if (e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                if (file.name.endsWith('.html') || file.name.endsWith('.htm')) {
                    this.handleFileSelect(file);
                } else {
                    this.showToast('请选择 HTML 文件', 'error');
                }
            }
        });
    }
    
    // 处理文件选择
    handleFileSelect(file) {
        this.selectedFile = file;
        this.fileName.textContent = file.name;
        this.fileUploadArea.style.display = 'none';
        this.fileSelected.style.display = 'flex';
        
        // 清空 URL 输入
        this.urlInput.value = '';
        
        this.showToast('文件已选择，点击保存按钮处理', 'success');
    }
    
    // 清除选择的文件
    clearSelectedFile() {
        this.selectedFile = null;
        this.fileInput.value = '';
        this.fileUploadArea.style.display = 'block';
        this.fileSelected.style.display = 'none';
    }
    
    showToast(message, type = 'info') {
        this.toast.textContent = message;
        this.toast.className = `toast show ${type}`;
        setTimeout(() => this.toast.classList.remove('show'), 3000);
    }
    
    showStatus(message, type = 'info') {
        this.statusDiv.textContent = message;
        this.statusDiv.className = `status ${type}`;
    }
    
    showProgress(show = true) {
        this.progressDiv.style.display = show ? 'block' : 'none';
    }
    
    updateProgress(percent, text) {
        this.progressFill.style.width = `${percent}%`;
        this.progressText.textContent = text;
    }
    
    async getHistory() {
        try {
            return await this.storage.getAll();
        } catch (e) {
            return [];
        }
    }
    
    async addToHistory(item) {
        try {
            await this.storage.add(item);
            await this.renderHistory();
            await this.updateStorageInfo();
        } catch (e) {
            console.error('保存历史失败:', e);
        }
    }
    
    async deleteFromHistory(id) {
        try {
            await this.storage.delete(id);
            await this.renderHistory();
            await this.updateStorageInfo();
            this.showToast('已删除', 'success');
        } catch (e) {
            this.showToast('删除失败', 'error');
        }
    }
    
    async clearAllHistory() {
        if (confirm('确定要清空所有历史记录吗？')) {
            try {
                await this.storage.clear();
                await this.renderHistory();
                await this.updateStorageInfo();
                this.showToast('已清空', 'success');
            } catch (e) {
                this.showToast('清空失败', 'error');
            }
        }
    }
    
    async renderHistory() {
        let history = await this.getHistory();
        const searchTerm = this.searchInput.value.toLowerCase().trim();
        
        if (searchTerm) {
            history = history.filter(item => 
                (item.title?.toLowerCase().includes(searchTerm)) ||
                (item.url?.toLowerCase().includes(searchTerm))
            );
        }
        
        this.historyCount.textContent = history.length;
        
        if (history.length === 0) {
            this.historyList.innerHTML = `
                <div class="history-empty">
                    <div class="history-empty-icon">${searchTerm ? '🔍' : '📭'}</div>
                    <p>${searchTerm ? '未找到匹配的记录' : '暂无历史记录'}</p>
                </div>
            `;
            return;
        }
        
        this.historyList.innerHTML = history.map(item => `
            <div class="history-item" data-id="${item.id}">
                <div class="history-item-header">
                    <div class="history-item-title">${this.escapeHtml(item.title || '无标题')}</div>
                    <div class="history-item-time">${this.formatTime(item.savedAt)}</div>
                </div>
                <div class="history-item-url">${this.escapeHtml(item.url)}</div>
                <div class="history-item-meta">📦 ${this.formatSize(item.size)}</div>
                <div class="history-item-actions">
                    <button class="btn btn-small btn-success" onclick="app.preview('${item.id}')">👁️ 预览</button>
                    <button class="btn btn-small" onclick="app.download('${item.id}')">📥 下载</button>
                    <button class="btn btn-small btn-danger" onclick="app.deleteFromHistory('${item.id}')">🗑️ 删除</button>
                </div>
            </div>
        `).join('');
    }
    
    async updateStorageInfo() {
        try {
            const info = await this.storage.getStorageInfo();
            const usedMB = (info.usage / 1024 / 1024).toFixed(2);
            const quotaMB = (info.quota / 1024 / 1024).toFixed(0);
            const percent = Math.min((info.usage / info.quota) * 100, 100);
            
            this.storageSize.textContent = `${usedMB} MB / ${quotaMB} MB`;
            
            const bar = document.querySelector('.storage-bar-fill');
            if (bar) {
                bar.style.width = `${percent}%`;
                bar.style.background = percent > 80 ? '#dc3545' : percent > 60 ? '#ffc107' : '#28a745';
            }
        } catch (e) {
            this.storageSize.textContent = '计算中...';
        }
    }
    
    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    }
    
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const diff = Date.now() - date;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
        return date.toLocaleDateString('zh-CN');
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // 预览功能
    async preview(id) {
        try {
            const item = await this.storage.get(id);
            if (!item) {
                this.showToast('记录不存在', 'error');
                return;
            }
            this.currentPreviewItem = item;
            this.previewTitle.textContent = item.title || '无标题';
            this.previewFrame.srcdoc = item.content;
            this.previewModal.classList.add('active');
            document.body.style.overflow = 'hidden';
        } catch (e) {
            console.error('预览失败:', e);
            this.showToast('预览失败: ' + e.message, 'error');
        }
    }
    
    closePreview() {
        this.previewModal.classList.remove('active');
        this.previewFrame.srcdoc = '';
        document.body.style.overflow = '';
        this.currentPreviewItem = null;
    }
    
    downloadFromPreview() {
        if (this.currentPreviewItem) {
            this.doDownload(this.currentPreviewItem.content, this.currentPreviewItem.filename);
        }
    }
    
    async download(id) {
        try {
            const item = await this.storage.get(id);
            if (!item) {
                this.showToast('记录不存在', 'error');
                return;
            }
            this.doDownload(item.content, item.filename);
        } catch (e) {
            this.showToast('下载失败: ' + e.message, 'error');
        }
    }
    
    // 下载函数
    doDownload(html, filename) {
        if (!filename.endsWith('.html')) {
            filename += '.html';
        }
        
        try {
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
            
            this.showToast('下载成功: ' + filename, 'success');
        } catch (e) {
            console.error('下载失败:', e);
            const win = window.open('', '_blank');
            if (win) {
                win.document.write(html);
                win.document.close();
                this.showToast('请按 Ctrl+S 保存', 'info');
            }
        }
    }
    
    // 代理请求
    async fetchWithProxy(url) {
        for (let i = 0; i < this.corsProxies.length; i++) {
            const proxy = this.corsProxies[(this.currentProxyIndex + i) % this.corsProxies.length];
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时
                
                const response = await fetch(proxy + encodeURIComponent(url), {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                
                if (response.ok) {
                    this.currentProxyIndex = (this.currentProxyIndex + i) % this.corsProxies.length;
                    return response;
                }
            } catch (error) {
                continue;
            }
        }
        throw new Error('所有代理都失败了');
    }
    
    // 图片下载 - 3秒超时快速失败
    async fetchAsBase64(url) {
        if (this.resourceCache.has(url)) return this.resourceCache.get(url);
        
        for (let i = 0; i < this.corsProxies.length; i++) {
            const proxy = this.corsProxies[(this.currentProxyIndex + i) % this.corsProxies.length];
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);
                
                const response = await fetch(proxy + encodeURIComponent(url), {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                
                if (!response.ok) continue;
                
                const blob = await response.blob();
                if (!blob.type.startsWith('image/') && !blob.type.includes('octet-stream')) {
                    continue;
                }
                
                const base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
                
                this.resourceCache.set(url, base64);
                return base64;
                
            } catch (error) {
                continue;
            }
        }
        
        return null;
    }
    
    // 获取图片代理 URL（用于无法下载的图片）
    getProxyImageUrl(originalUrl) {
        // 使用 CORS 代理作为图片代理
        // 这样浏览器会通过代理加载图片，绕过防盗链
        return this.corsProxies[0] + encodeURIComponent(originalUrl);
    }
    
    resolveUrl(base, relative) {
        if (!relative || relative.startsWith('data:')) return relative;
        if (relative.startsWith('//')) return 'https:' + relative;
        if (relative.startsWith('http://') || relative.startsWith('https://')) return relative;
        try {
            return new URL(relative, base).href;
        } catch {
            return relative;
        }
    }
    
    isImageUrl(url) {
        if (!url || url.startsWith('data:')) return false;
        const cleanUrl = url.split('?')[0].split('#')[0];
        return /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)(\?|$)/i.test(cleanUrl);
    }
    
    // 检测是否是微信公众号链接
    isWechatArticle(url) {
        return url.includes('mp.weixin.qq.com') || url.includes('mp.weixin.qq.com/s/');
    }
    
    // 通过 wechat-article-exporter API 获取微信文章
    async fetchWechatArticle(url) {
        const apiUrl = `https://down.mptext.top/api/public/v1/download?url=${encodeURIComponent(url)}&format=html`;
        
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error('微信文章获取失败');
        }
        
        return await response.text();
    }
    
    async save() {
        // 检查是否有选中的文件
        if (this.selectedFile) {
            return this.saveFromFile();
        }
        
        // 从 URL 保存
        const url = this.urlInput.value.trim();
        
        if (!url) {
            this.showStatus('请输入URL或选择本地文件', 'error');
            return;
        }
        
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            this.showStatus('URL必须以 http:// 或 https:// 开头', 'error');
            return;
        }
        
        this.stats = { imagesProcessed: 0, imagesSuccess: 0, imagesFailed: 0 };
        this.resourceCache.clear();
        
        this.saveBtn.disabled = true;
        this.showProgress(true);
        this.updateProgress(0, '正在获取网页...');
        
        try {
            this.updateProgress(10, '正在获取HTML...');
            
            let html;
            
            // 检测是否是微信公众号链接
            if (this.isWechatArticle(url)) {
                this.updateProgress(15, '检测到微信文章，使用专用API获取...');
                html = await this.fetchWechatArticle(url);
            } else {
                const response = await this.fetchWithProxy(url);
                html = await response.text();
            }
            
            await this.processAndSave(html, url);
            
        } catch (error) {
            console.error('Save failed:', error);
            this.showStatus(`❌ 保存失败: ${error.message}`, 'error');
            this.showToast('保存失败: ' + error.message, 'error');
        } finally {
            this.saveBtn.disabled = false;
            setTimeout(() => this.showProgress(false), 2000);
        }
    }
    
    // 从本地文件保存
    async saveFromFile() {
        if (!this.selectedFile) return;
        
        this.stats = { imagesProcessed: 0, imagesSuccess: 0, imagesFailed: 0 };
        this.resourceCache.clear();
        
        this.saveBtn.disabled = true;
        this.showProgress(true);
        this.updateProgress(0, '正在读取文件...');
        
        try {
            // 读取文件内容
            const html = await this.readFileAsText(this.selectedFile);
            
            this.updateProgress(20, '正在解析HTML...');
            
            // 解析 HTML 获取标题
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const title = doc.querySelector('title')?.textContent || this.selectedFile.name;
            
            // 使用文件名作为 URL 标识
            const url = `file://${this.selectedFile.name}`;
            
            await this.processAndSave(html, url, title);
            
            // 清除选中的文件
            this.clearSelectedFile();
            
        } catch (error) {
            console.error('File save failed:', error);
            this.showStatus(`❌ 保存失败: ${error.message}`, 'error');
            this.showToast('保存失败: ' + error.message, 'error');
        } finally {
            this.saveBtn.disabled = false;
            setTimeout(() => this.showProgress(false), 2000);
        }
    }
    
    // 读取文件为文本
    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('文件读取失败'));
            reader.readAsText(file);
        });
    }
    
    // 处理并保存 HTML
    async processAndSave(html, url, customTitle = null) {
        this.updateProgress(20, '正在解析HTML...');
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const title = customTitle || doc.querySelector('title')?.textContent || url;
        
        const options = {
            inlineImages: document.getElementById('inlineImages').checked,
            inlineCSS: document.getElementById('inlineCSS').checked,
            inlineFonts: document.getElementById('inlineFonts').checked,
            removeScripts: document.getElementById('removeScripts').checked,
            unlockCopy: document.getElementById('unlockCopy')?.checked ?? true
        };
        
        let baseUrl = url;
        const baseTag = doc.querySelector('base[href]');
        if (baseTag) baseUrl = this.resolveUrl(url, baseTag.getAttribute('href'));
        
        // 并行处理CSS和图片
        const tasks = [];
        
        if (options.inlineCSS) {
            tasks.push(this.processStyles(doc, baseUrl, options));
        }
        
        if (options.inlineImages) {
            tasks.push(this.processAllImages(doc, baseUrl));
        }
        
        if (tasks.length > 0) {
            this.updateProgress(30, '正在处理资源...');
            await Promise.all(tasks);
        }
        
        // 解除复制限制
        if (options.unlockCopy) {
            this.unlockCopyRestrictions(doc);
        }
        
        if (options.removeScripts) {
            this.updateProgress(85, '正在移除脚本...');
            this.removeScripts(doc);
        }
        
        this.updateProgress(90, '正在生成文件...');
        this.addSaveInfo(doc, url);
        
        const finalHtml = this.serializeHTML(doc);
        const filename = this.getFilename(url);
        const size = new Blob([finalHtml]).size;
        
        if (size / 1024 / 1024 > 10) {
            throw new Error(`文件过大 (${(size / 1024 / 1024).toFixed(2)} MB)，超过 10MB 限制`);
        }
        
        await this.addToHistory({
            id: Date.now().toString(),
            url, title, filename,
            content: finalHtml,
            savedAt: new Date().toISOString(),
            size
        });
        
        this.updateProgress(100, '完成！');
        this.doDownload(finalHtml, filename);
        
        const imgInfo = this.stats.imagesProcessed > 0 
            ? ` (图片: ${this.stats.imagesSuccess}/${this.stats.imagesProcessed})` : '';
        this.showStatus(`✅ 保存成功！(${this.formatSize(size)})${imgInfo}`, 'success');
        
        this.urlInput.value = '';
    }
    
    // 并行处理图片
    async processAllImages(doc, baseUrl) {
        const images = Array.from(doc.querySelectorAll('img'));
        const total = images.length;
        
        if (total === 0) return;
        
        this.updateProgress(40, `发现 ${total} 张图片...`);
        
        // 10个并发
        const batchSize = 10;
        
        for (let i = 0; i < images.length; i += batchSize) {
            const batch = images.slice(i, i + batchSize);
            await Promise.all(batch.map(img => this.processSingleImage(img, baseUrl)));
            
            const processed = Math.min(i + batchSize, total);
            this.updateProgress(40 + (processed / total) * 40, `处理图片 ${processed}/${total}...`);
        }
        
        // 背景图
        const styleElements = Array.from(doc.querySelectorAll('[style*="url("]'));
        await Promise.all(styleElements.map(el => this.processInlineStyleImage(el, baseUrl)));
        
        // picture 元素
        await this.processPictureElements(doc, baseUrl);
    }
    
    async processSingleImage(img, baseUrl) {
        const lazyAttrs = ['data-src', 'data-original', 'data-lazy-src', 'data-lazyload', 
                          'data-image', 'data-srcset', 'data-nimg'];
        
        const sources = [];
        
        for (const attr of lazyAttrs) {
            const val = img.getAttribute(attr);
            if (val && !val.startsWith('data:')) {
                sources.push(val.split(/[\s,]+/)[0]);
            }
        }
        
        const src = img.getAttribute('src');
        if (src && !src.startsWith('data:')) {
            sources.push(src);
        }
        
        const srcset = img.getAttribute('srcset');
        if (srcset) {
            const url = srcset.split(',')[0].trim().split(/\s+/)[0];
            if (url && !url.startsWith('data:')) {
                sources.unshift(url);
            }
        }
        
        for (const url of sources) {
            let finalUrl = url;
            
            if (finalUrl.includes('/_next/image')) {
                const match = finalUrl.match(/[?&]url=([^&]+)/);
                if (match) {
                    finalUrl = decodeURIComponent(match[1]);
                }
            }
            
            const absoluteUrl = this.resolveUrl(baseUrl, finalUrl);
            this.stats.imagesProcessed++;
            
            const base64 = await this.fetchAsBase64(absoluteUrl);
            
            if (base64) {
                // 成功下载，使用 base64
                img.setAttribute('src', base64);
                lazyAttrs.forEach(attr => img.removeAttribute(attr));
                img.removeAttribute('srcset');
                img.removeAttribute('loading');
                this.stats.imagesSuccess++;
                return;
            } else {
                // 下载失败，使用代理 URL
                this.stats.imagesFailed++;
                if (absoluteUrl.startsWith('http')) {
                    // 使用代理 URL 代替原始 URL，绕过防盗链
                    const proxyUrl = this.getProxyImageUrl(absoluteUrl);
                    img.setAttribute('src', proxyUrl);
                    img.removeAttribute('crossorigin');
                    lazyAttrs.forEach(attr => img.removeAttribute(attr));
                    img.removeAttribute('srcset');
                    img.removeAttribute('loading');
                    // 记录原始 URL
                    img.setAttribute('data-original-src', absoluteUrl);
                    return;
                }
            }
        }
    }
    
    async processInlineStyleImage(el, baseUrl) {
        let style = el.getAttribute('style');
        if (!style) return;
        
        const matches = [...style.matchAll(/url\(\s*['"]?([^'"\)\s]+)['"]?\s*\)/gi)];
        
        for (const match of matches) {
            const url = match[1];
            if (url.startsWith('data:')) continue;
            
            if (this.isImageUrl(url)) {
                this.stats.imagesProcessed++;
                const absoluteUrl = this.resolveUrl(baseUrl, url);
                const base64 = await this.fetchAsBase64(absoluteUrl);
                
                if (base64) {
                    style = style.replace(match[0], `url(${base64})`);
                    this.stats.imagesSuccess++;
                } else {
                    this.stats.imagesFailed++;
                }
            }
        }
        
        el.setAttribute('style', style);
    }
    
    async processPictureElements(doc, baseUrl) {
        const sources = Array.from(doc.querySelectorAll('source[srcset], source[src]'));
        
        await Promise.all(sources.map(async (source) => {
            const srcset = source.getAttribute('srcset');
            if (srcset) {
                const newSrcset = await this.processSrcset(srcset, baseUrl);
                if (newSrcset) source.setAttribute('srcset', newSrcset);
            }
            
            const src = source.getAttribute('src');
            if (src && !src.startsWith('data:')) {
                this.stats.imagesProcessed++;
                const absoluteUrl = this.resolveUrl(baseUrl, src);
                const base64 = await this.fetchAsBase64(absoluteUrl);
                if (base64) {
                    source.setAttribute('src', base64);
                    this.stats.imagesSuccess++;
                } else {
                    this.stats.imagesFailed++;
                }
            }
        }));
    }
    
    async processStyles(doc, baseUrl, options) {
        const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
        
        await Promise.all(links.map(async (link) => {
            try {
                const href = link.getAttribute('href');
                if (!href) return;
                
                const absoluteUrl = this.resolveUrl(baseUrl, href);
                const response = await this.fetchWithProxy(absoluteUrl);
                let css = await response.text();
                
                if (options.inlineImages) {
                    css = await this.processCSSUrls(css, absoluteUrl);
                }
                
                const style = doc.createElement('style');
                style.textContent = css;
                link.replaceWith(style);
            } catch (e) {
                console.warn('CSS 处理失败:', e);
            }
        }));
        
        const styles = Array.from(doc.querySelectorAll('style'));
        await Promise.all(styles.map(async (style) => {
            let css = style.textContent;
            if (options.inlineImages) {
                css = await this.processCSSUrls(css, baseUrl);
            }
            style.textContent = css;
        }));
    }
    
    async processCSSUrls(css, baseUrl) {
        const urlRegex = /url\(\s*['"]?([^'"\)\s]+)['"]?\s*\)/gi;
        const replacements = [];
        
        for (const match of css.matchAll(urlRegex)) {
            const url = match[1];
            if (url.startsWith('data:')) continue;
            
            const absoluteUrl = this.resolveUrl(baseUrl, url);
            
            if (this.isImageUrl(url)) {
                this.stats.imagesProcessed++;
                const base64 = await this.fetchAsBase64(absoluteUrl);
                if (base64) {
                    replacements.push({ original: match[0], replacement: `url(${base64})` });
                    this.stats.imagesSuccess++;
                } else {
                    this.stats.imagesFailed++;
                }
            }
        }
        
        for (const { original, replacement } of replacements) {
            css = css.replace(original, replacement);
        }
        
        return css;
    }
    
    async processSrcset(srcset, baseUrl) {
        if (!srcset) return null;
        
        const parts = srcset.split(',').map(p => p.trim());
        const newParts = [];
        
        for (const part of parts) {
            const [url, descriptor] = part.split(/\s+/);
            if (url.startsWith('data:')) {
                newParts.push(part);
                continue;
            }
            
            this.stats.imagesProcessed++;
            const absoluteUrl = this.resolveUrl(baseUrl, url);
            const base64 = await this.fetchAsBase64(absoluteUrl);
            
            if (base64) {
                newParts.push(descriptor ? `${base64} ${descriptor}` : base64);
                this.stats.imagesSuccess++;
            } else {
                newParts.push(part);
                this.stats.imagesFailed++;
            }
        }
        
        return newParts.join(', ');
    }
    
    // 解除复制限制
    unlockCopyRestrictions(doc) {
        // 移除禁止复制的事件属性
        const eventAttrs = ['oncopy', 'oncut', 'onpaste', 'onselectstart', 'oncontextmenu',
                          'ondragstart', 'onmousedown', 'onmouseup', 'onselect'];
        doc.querySelectorAll('[' + eventAttrs.join('],[') + ']').forEach(el => {
            eventAttrs.forEach(attr => el.removeAttribute(attr));
        });
        
        // 添加允许选择的样式
        const style = doc.createElement('style');
        style.textContent = `
            /* WebPage Saver - 解除复制限制 */
            *, *::before, *::after {
                -webkit-user-select: text !important;
                -moz-user-select: text !important;
                -ms-user-select: text !important;
                user-select: text !important;
                -webkit-touch-callout: default !important;
            }
        `;
        doc.head?.appendChild(style);
    }
    
    removeScripts(doc) {
        doc.querySelectorAll('script').forEach(el => el.remove());
        doc.querySelectorAll('noscript').forEach(el => el.remove());
        
        // 移除事件处理属性
        const eventAttrs = ['onclick', 'onload', 'onerror', 'onmouseover', 'onmouseout',
                          'oncopy', 'oncut', 'onpaste', 'onselectstart', 'oncontextmenu',
                          'ondragstart', 'onkeydown', 'onkeyup', 'onkeypress'];
        doc.querySelectorAll('[' + eventAttrs.join('],[') + ']').forEach(el => {
            eventAttrs.forEach(attr => el.removeAttribute(attr));
        });
        
        // 如果同时开启了解除复制限制，添加样式
        if (document.getElementById('unlockCopy')?.checked) {
            const style = doc.createElement('style');
            style.textContent = `
                /* WebPage Saver - 解除复制限制 */
                *, *::before, *::after {
                    -webkit-user-select: text !important;
                    -moz-user-select: text !important;
                    -ms-user-select: text !important;
                    user-select: text !important;
                    -webkit-touch-callout: default !important;
                }
            `;
            doc.head?.appendChild(style);
        }
    }
    
    addSaveInfo(doc, originalUrl) {
        const comment = doc.createComment(`Saved by WebPage Saver | ${originalUrl} | ${new Date().toISOString()}`);
        doc.documentElement.insertBefore(comment, doc.documentElement.firstChild);
        
        const title = doc.querySelector('title');
        if (title) title.textContent = `[Saved] ${title.textContent}`;
    }
    
    serializeHTML(doc) {
        return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    }
    
    getFilename(url) {
        try {
            const urlObj = new URL(url);
            return `${urlObj.hostname.replace(/\./g, '_')}_${new Date().toISOString().slice(0, 10)}.html`;
        } catch {
            return `saved_page_${Date.now()}.html`;
        }
    }
}

let app;
document.addEventListener('DOMContentLoaded', async () => {
    app = new WebPageSaver();
});
