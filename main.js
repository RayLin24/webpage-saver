/**
 * WebPage Saver - 网页保存工具
 * 将任意网页保存为单个HTML文件，支持历史记录、预览和下载
 * 使用 IndexedDB 支持大文件存储
 */

class StorageManager {
    constructor() {
        this.dbName = 'WebPageSaverDB';
        this.dbVersion = 1;
        this.storeName = 'pages';
        this.db = null;
    }
    
    async init() {
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
                    store.createIndex('url', 'url', { unique: false });
                }
            };
        });
    }
    
    async add(item) {
        return new Promise((resolve, reject) => {
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
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            return {
                usage: estimate.usage || 0,
                quota: estimate.quota || 0
            };
        }
        
        const all = await this.getAll();
        let totalSize = 0;
        for (const item of all) {
            if (item.content) {
                totalSize += new Blob([item.content]).size;
            }
        }
        
        return {
            usage: totalSize,
            quota: 10 * 1024 * 1024
        };
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
        
        this.currentPreviewItem = null;
        this.storage = new StorageManager();
        
        // CORS代理列表
        this.corsProxies = [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?',
            'https://api.codetabs.com/v1/proxy?quest='
        ];
        
        this.currentProxyIndex = 0;
        
        // 资源缓存
        this.resourceCache = new Map();
        
        // 统计
        this.stats = {
            imagesProcessed: 0,
            imagesSuccess: 0,
            imagesFailed: 0
        };
        
        this.init();
    }
    
    async init() {
        try {
            await this.storage.init();
            console.log('IndexedDB 初始化成功');
        } catch (e) {
            console.error('IndexedDB 初始化失败:', e);
            this.showToast('存储初始化失败，请刷新页面重试', 'error');
        }
        
        this.saveBtn.addEventListener('click', () => this.save());
        this.urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.save();
        });
        
        this.searchInput.addEventListener('input', () => this.renderHistory());
        this.clearAllBtn.addEventListener('click', () => this.clearAllHistory());
        
        document.getElementById('closeModal').addEventListener('click', () => this.closePreview());
        document.getElementById('closePreviewBtn').addEventListener('click', () => this.closePreview());
        document.getElementById('downloadFromPreview').addEventListener('click', () => this.downloadCurrentPreview());
        
        this.previewModal.addEventListener('click', (e) => {
            if (e.target === this.previewModal) this.closePreview();
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closePreview();
        });
        
        await this.renderHistory();
        await this.updateStorageInfo();
    }
    
    showToast(message, type = 'info') {
        this.toast.textContent = message;
        this.toast.className = `toast show ${type}`;
        setTimeout(() => {
            this.toast.classList.remove('show');
        }, 3000);
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
            console.error('Failed to load history:', e);
            return [];
        }
    }
    
    async addToHistory(item) {
        try {
            await this.storage.add(item);
            await this.renderHistory();
            await this.updateStorageInfo();
        } catch (e) {
            console.error('Failed to save history:', e);
            this.showToast('保存失败: ' + e.message, 'error');
        }
    }
    
    async deleteFromHistory(id) {
        try {
            await this.storage.delete(id);
            await this.renderHistory();
            await this.updateStorageInfo();
            this.showToast('已删除记录', 'success');
        } catch (e) {
            console.error('Failed to delete:', e);
            this.showToast('删除失败', 'error');
        }
    }
    
    async clearAllHistory() {
        if (confirm('确定要清空所有历史记录吗？此操作不可恢复。')) {
            try {
                await this.storage.clear();
                await this.renderHistory();
                await this.updateStorageInfo();
                this.showToast('已清空所有记录', 'success');
            } catch (e) {
                console.error('Failed to clear:', e);
                this.showToast('清空失败', 'error');
            }
        }
    }
    
    async renderHistory() {
        let history = await this.getHistory();
        const searchTerm = this.searchInput.value.toLowerCase().trim();
        
        if (searchTerm) {
            history = history.filter(item => 
                (item.title && item.title.toLowerCase().includes(searchTerm)) ||
                (item.url && item.url.toLowerCase().includes(searchTerm))
            );
        }
        
        this.historyCount.textContent = history.length;
        
        if (history.length === 0) {
            this.historyList.innerHTML = `
                <div class="history-empty">
                    <div class="history-empty-icon">${searchTerm ? '🔍' : '📭'}</div>
                    <p>${searchTerm ? '未找到匹配的记录' : '暂无历史记录'}</p>
                    ${!searchTerm ? '<p style="font-size: 12px; margin-top: 5px;">保存的网页将显示在这里</p>' : ''}
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
                <div class="history-item-meta">
                    <span>📦 ${this.formatSize(item.size)}</span>
                </div>
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
            
            const storageBarFill = document.querySelector('.storage-bar-fill');
            if (storageBarFill) {
                storageBarFill.style.width = `${percent}%`;
                if (percent > 80) {
                    storageBarFill.style.background = '#dc3545';
                } else if (percent > 60) {
                    storageBarFill.style.background = '#ffc107';
                } else {
                    storageBarFill.style.background = '#28a745';
                }
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
        const now = new Date();
        const diff = now - date;
        
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
            console.error('Preview failed:', e);
            this.showToast('预览失败', 'error');
        }
    }
    
    closePreview() {
        this.previewModal.classList.remove('active');
        this.previewFrame.srcdoc = '';
        document.body.style.overflow = '';
        this.currentPreviewItem = null;
    }
    
    async downloadCurrentPreview() {
        if (this.currentPreviewItem) {
            await this.download(this.currentPreviewItem.id);
        }
    }
    
    async download(id) {
        try {
            const item = await this.storage.get(id);
            
            if (!item) {
                this.showToast('记录不存在', 'error');
                return;
            }
            
            console.log('开始下载:', item.filename, '大小:', item.size);
            this.showStatus('正在下载...', 'info');
            
            this.downloadHTML(item.content, item.filename);
            this.showToast('下载已开始', 'success');
            this.showStatus('✅ 下载已触发，请检查浏览器下载列表', 'success');
        } catch (e) {
            console.error('Download failed:', e);
            this.showToast('下载失败: ' + e.message, 'error');
            this.showStatus('❌ 下载失败: ' + e.message, 'error');
        }
    }
    
    async fetchWithProxy(url, options = {}) {
        let lastError;
        
        for (let i = 0; i < this.corsProxies.length; i++) {
            const proxyIndex = (this.currentProxyIndex + i) % this.corsProxies.length;
            const proxy = this.corsProxies[proxyIndex];
            
            try {
                const proxyUrl = proxy + encodeURIComponent(url);
                const response = await fetch(proxyUrl, {
                    ...options,
                    headers: {
                        ...options.headers
                    }
                });
                
                if (response.ok) {
                    this.currentProxyIndex = proxyIndex;
                    return response;
                }
            } catch (error) {
                lastError = error;
                console.warn(`Proxy ${proxy} failed:`, error.message);
            }
        }
        
        throw new Error(`所有代理都失败了: ${lastError?.message || 'Unknown error'}`);
    }
    
    async fetchAsBase64(url) {
        // 检查缓存
        if (this.resourceCache.has(url)) {
            return this.resourceCache.get(url);
        }
        
        try {
            const response = await this.fetchWithProxy(url);
            const blob = await response.blob();
            
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    this.resourceCache.set(url, reader.result);
                    resolve(reader.result);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            console.warn(`Failed to fetch ${url}:`, error);
            return null;
        }
    }
    
    resolveUrl(base, relative) {
        if (!relative) return relative;
        
        // 处理 data: URI
        if (relative.startsWith('data:')) return relative;
        
        // 处理协议相对路径
        if (relative.startsWith('//')) {
            return 'https:' + relative;
        }
        
        // 处理绝对路径
        if (relative.startsWith('http://') || relative.startsWith('https://')) {
            return relative;
        }
        
        try {
            return new URL(relative, base).href;
        } catch {
            return relative;
        }
    }
    
    // 判断是否是图片 URL
    isImageUrl(url) {
        if (!url || url.startsWith('data:')) return false;
        
        // 移除查询参数和哈希
        const cleanUrl = url.split('?')[0].split('#')[0];
        
        // 支持更多图片格式
        return /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif|heic|heif|tiff?)(\?|$|#)/i.test(cleanUrl) ||
               // 检查 URL 中是否包含图片相关关键词
               /\/img\/|\/images\/|\/image\/|image\.|img\.|pic\.|photo\./i.test(url);
    }
    
    async save() {
        const url = this.urlInput.value.trim();
        
        if (!url) {
            this.showStatus('请输入有效的URL', 'error');
            return;
        }
        
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            this.showStatus('URL必须以 http:// 或 https:// 开头', 'error');
            return;
        }
        
        // 重置统计
        this.stats = { imagesProcessed: 0, imagesSuccess: 0, imagesFailed: 0 };
        this.resourceCache.clear();
        
        this.saveBtn.disabled = true;
        this.showProgress(true);
        this.updateProgress(0, '正在获取网页...');
        this.showStatus('处理中...', 'info');
        
        try {
            this.updateProgress(10, '正在获取网页HTML...');
            const response = await this.fetchWithProxy(url);
            let html = await response.text();
            
            this.updateProgress(20, '正在解析HTML...');
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            const title = doc.querySelector('title')?.textContent || url;
            
            const options = {
                inlineImages: document.getElementById('inlineImages').checked,
                inlineCSS: document.getElementById('inlineCSS').checked,
                inlineFonts: document.getElementById('inlineFonts').checked,
                removeScripts: document.getElementById('removeScripts').checked
            };
            
            let baseUrl = url;
            const baseTag = doc.querySelector('base[href]');
            if (baseTag) {
                baseUrl = this.resolveUrl(url, baseTag.getAttribute('href'));
            }
            
            // 处理CSS
            if (options.inlineCSS) {
                this.updateProgress(30, '正在处理CSS样式...');
                await this.processStyles(doc, baseUrl, options);
            }
            
            // 处理图片
            if (options.inlineImages) {
                this.updateProgress(50, '正在处理图片...');
                await this.processAllImages(doc, baseUrl);
            }
            
            // 处理脚本
            if (options.removeScripts) {
                this.updateProgress(70, '正在移除脚本...');
                this.removeScripts(doc);
            }
            
            this.updateProgress(80, '正在生成文件...');
            this.addSaveInfo(doc, url);
            
            this.updateProgress(90, '正在保存...');
            const finalHtml = this.serializeHTML(doc);
            const filename = this.getFilename(url);
            const size = new Blob([finalHtml]).size;
            
            const sizeMB = size / 1024 / 1024;
            if (sizeMB > 10) {
                throw new Error(`文件过大 (${sizeMB.toFixed(2)} MB)，超过 10MB 限制`);
            }
            
            const historyItem = {
                id: Date.now().toString(),
                url: url,
                title: title,
                filename: filename,
                content: finalHtml,
                savedAt: new Date().toISOString(),
                size: size
            };
            
            await this.addToHistory(historyItem);
            
            this.updateProgress(100, '完成！');
            this.downloadHTML(finalHtml, filename);
            
            const imgStats = this.stats.imagesProcessed > 0 
                ? ` (图片: ${this.stats.imagesSuccess}/${this.stats.imagesProcessed})` 
                : '';
            this.showStatus(`✅ 网页已成功保存！(${this.formatSize(size)})${imgStats}`, 'success');
            this.showToast(`网页保存成功！大小: ${this.formatSize(size)}`, 'success');
            
            this.urlInput.value = '';
            
        } catch (error) {
            console.error('Save failed:', error);
            this.showStatus(`❌ 保存失败: ${error.message}`, 'error');
            this.showToast('保存失败: ' + error.message, 'error');
        } finally {
            this.saveBtn.disabled = false;
            setTimeout(() => this.showProgress(false), 2000);
        }
    }
    
    // 处理所有类型的图片
    async processAllImages(doc, baseUrl) {
        // 1. 处理 <img> 标签
        await this.processImgTags(doc, baseUrl);
        
        // 2. 处理内联样式中的背景图片
        await this.processInlineStyleImages(doc, baseUrl);
        
        // 3. 处理 <picture> 和 <source>
        await this.processPictureElements(doc, baseUrl);
        
        // 4. 处理 <svg> 中的 <image>
        await this.processSvgImages(doc, baseUrl);
        
        // 5. 处理 video poster
        await this.processVideoPosters(doc, baseUrl);
        
        // 6. 处理 input type="image"
        await this.processInputImages(doc, baseUrl);
        
        console.log(`图片处理完成: ${this.stats.imagesSuccess}/${this.stats.imagesProcessed} 成功`);
    }
    
    async processImgTags(doc, baseUrl) {
        const images = doc.querySelectorAll('img');
        
        for (const img of images) {
            // 获取图片源（支持多种懒加载属性）
            let src = img.getAttribute('src');
            const dataSrc = img.getAttribute('data-src') || 
                          img.getAttribute('data-original') ||
                          img.getAttribute('data-lazy-src') ||
                          img.getAttribute('data-lazyload') ||
                          img.getAttribute('data-image');
            
            // 如果有 data-src 且 src 是占位符，使用 data-src
            if (dataSrc && (!src || src.includes('data:image') || src.includes('placeholder') || src.includes('loading'))) {
                src = dataSrc;
            }
            
            if (!src || src.startsWith('data:')) {
                // 尝试其他属性
                const otherSrc = img.getAttribute('data-srcset') || 
                               img.getAttribute('data-lazy-srcset');
                if (otherSrc) {
                    src = otherSrc.split(/\s+/)[0];
                }
            }
            
            if (!src || src.startsWith('data:')) continue;
            
            this.stats.imagesProcessed++;
            
            const absoluteUrl = this.resolveUrl(baseUrl, src);
            const base64 = await this.fetchAsBase64(absoluteUrl);
            
            if (base64) {
                img.setAttribute('src', base64);
                // 清除懒加载属性
                img.removeAttribute('data-src');
                img.removeAttribute('data-original');
                img.removeAttribute('data-lazy-src');
                img.removeAttribute('data-lazyload');
                img.removeAttribute('loading');
                this.stats.imagesSuccess++;
            } else {
                this.stats.imagesFailed++;
            }
        }
        
        // 处理 srcset
        for (const img of doc.querySelectorAll('img[srcset]')) {
            const srcset = img.getAttribute('srcset');
            const newSrcset = await this.processSrcset(srcset, baseUrl);
            if (newSrcset) {
                img.setAttribute('srcset', newSrcset);
            }
        }
    }
    
    async processInlineStyleImages(doc, baseUrl) {
        // 处理所有带 style 属性的元素
        const elementsWithStyle = doc.querySelectorAll('[style*="background"], [style*="url("]');
        
        for (const el of elementsWithStyle) {
            let style = el.getAttribute('style');
            if (!style) continue;
            
            // 匹配 url() 中的图片
            const urlMatches = style.match(/url\(\s*['"]?([^'"\)\s]+)['"]?\s*\)/gi);
            if (!urlMatches) continue;
            
            for (const match of urlMatches) {
                const urlMatch = match.match(/url\(\s*['"]?([^'"\)\s]+)['"]?\s*\)/i);
                if (!urlMatch) continue;
                
                const imgUrl = urlMatch[1];
                if (imgUrl.startsWith('data:')) continue;
                
                if (this.isImageUrl(imgUrl)) {
                    this.stats.imagesProcessed++;
                    const absoluteUrl = this.resolveUrl(baseUrl, imgUrl);
                    const base64 = await this.fetchAsBase64(absoluteUrl);
                    
                    if (base64) {
                        style = style.replace(match, `url(${base64})`);
                        this.stats.imagesSuccess++;
                    } else {
                        this.stats.imagesFailed++;
                    }
                }
            }
            
            el.setAttribute('style', style);
        }
    }
    
    async processPictureElements(doc, baseUrl) {
        const sources = doc.querySelectorAll('source[srcset], source[src]');
        
        for (const source of sources) {
            // 处理 srcset
            const srcset = source.getAttribute('srcset');
            if (srcset) {
                const newSrcset = await this.processSrcset(srcset, baseUrl);
                if (newSrcset) {
                    source.setAttribute('srcset', newSrcset);
                }
            }
            
            // 处理 src
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
        }
    }
    
    async processSvgImages(doc, baseUrl) {
        const svgImages = doc.querySelectorAll('svg image[href], svg image[xlink\\:href]');
        
        for (const img of svgImages) {
            const href = img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
            if (!href || href.startsWith('data:')) continue;
            
            if (this.isImageUrl(href)) {
                this.stats.imagesProcessed++;
                const absoluteUrl = this.resolveUrl(baseUrl, href);
                const base64 = await this.fetchAsBase64(absoluteUrl);
                
                if (base64) {
                    img.setAttribute('href', base64);
                    this.stats.imagesSuccess++;
                } else {
                    this.stats.imagesFailed++;
                }
            }
        }
    }
    
    async processVideoPosters(doc, baseUrl) {
        const videos = doc.querySelectorAll('video[poster]');
        
        for (const video of videos) {
            const poster = video.getAttribute('poster');
            if (!poster || poster.startsWith('data:')) continue;
            
            this.stats.imagesProcessed++;
            const absoluteUrl = this.resolveUrl(baseUrl, poster);
            const base64 = await this.fetchAsBase64(absoluteUrl);
            
            if (base64) {
                video.setAttribute('poster', base64);
                this.stats.imagesSuccess++;
            } else {
                this.stats.imagesFailed++;
            }
        }
    }
    
    async processInputImages(doc, baseUrl) {
        const inputs = doc.querySelectorAll('input[type="image"][src]');
        
        for (const input of inputs) {
            const src = input.getAttribute('src');
            if (!src || src.startsWith('data:')) continue;
            
            this.stats.imagesProcessed++;
            const absoluteUrl = this.resolveUrl(baseUrl, src);
            const base64 = await this.fetchAsBase64(absoluteUrl);
            
            if (base64) {
                input.setAttribute('src', base64);
                this.stats.imagesSuccess++;
            } else {
                this.stats.imagesFailed++;
            }
        }
    }
    
    async processStyles(doc, baseUrl, options) {
        // 处理 <link rel="stylesheet">
        const links = doc.querySelectorAll('link[rel="stylesheet"]');
        for (const link of links) {
            try {
                const href = link.getAttribute('href');
                if (!href) continue;
                
                const absoluteUrl = this.resolveUrl(baseUrl, href);
                const response = await this.fetchWithProxy(absoluteUrl);
                const css = await response.text();
                
                const style = doc.createElement('style');
                style.textContent = css;
                link.replaceWith(style);
            } catch (error) {
                console.warn('Failed to process stylesheet:', error);
            }
        }
        
        // 处理内联 <style>
        const styles = doc.querySelectorAll('style');
        for (const style of styles) {
            let css = style.textContent;
            css = await this.processCSSImports(css, baseUrl);
            
            if (options.inlineFonts || options.inlineImages) {
                css = await this.processCSSUrls(css, baseUrl, options);
            }
            
            style.textContent = css;
        }
    }
    
    async processCSSImports(css, baseUrl) {
        const importRegex = /@import\s+(?:url\()?['"]?([^'"\)]+)['"]?\)?;/g;
        const imports = css.matchAll(importRegex);
        
        for (const match of imports) {
            const importUrl = match[1];
            const absoluteUrl = this.resolveUrl(baseUrl, importUrl);
            
            try {
                const response = await this.fetchWithProxy(absoluteUrl);
                const importedCss = await response.text();
                css = css.replace(match[0], `/* @import from ${importUrl} */\n${importedCss}`);
            } catch (error) {
                console.warn('Failed to import CSS:', importUrl);
            }
        }
        
        return css;
    }
    
    async processCSSUrls(css, baseUrl, options) {
        const urlRegex = /url\(\s*['"]?([^'"\)\s]+)['"]?\s*\)/gi;
        const replacements = [];
        
        for (const match of css.matchAll(urlRegex)) {
            const resourceUrl = match[1];
            if (resourceUrl.startsWith('data:')) continue;
            
            const absoluteUrl = this.resolveUrl(baseUrl, resourceUrl);
            
            const isFont = /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(resourceUrl);
            const isImage = this.isImageUrl(resourceUrl);
            
            if ((isFont && options.inlineFonts) || (isImage && options.inlineImages)) {
                if (isImage) this.stats.imagesProcessed++;
                
                const base64 = await this.fetchAsBase64(absoluteUrl);
                if (base64) {
                    replacements.push({
                        original: match[0],
                        replacement: `url(${base64})`
                    });
                    if (isImage) this.stats.imagesSuccess++;
                } else {
                    if (isImage) this.stats.imagesFailed++;
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
    
    removeScripts(doc) {
        doc.querySelectorAll('script').forEach(el => el.remove());
        
        const eventAttrs = ['onclick', 'onload', 'onerror', 'onmouseover', 'onmouseout', 
                          'onmousedown', 'onmouseup', 'onfocus', 'onblur', 'onchange',
                          'onsubmit', 'onkeydown', 'onkeyup', 'onkeypress'];
        
        doc.querySelectorAll('[' + eventAttrs.join('],[') + ']').forEach(el => {
            eventAttrs.forEach(attr => el.removeAttribute(attr));
        });
        
        doc.querySelectorAll('noscript').forEach(el => el.remove());
    }
    
    addSaveInfo(doc, originalUrl) {
        const comment = doc.createComment(`
    Saved by WebPage Saver
    Original URL: ${originalUrl}
    Saved at: ${new Date().toISOString()}
    `);
        doc.documentElement.insertBefore(comment, doc.documentElement.firstChild);
        
        const title = doc.querySelector('title');
        if (title) {
            title.textContent = `[Saved] ${title.textContent}`;
        }
    }
    
    serializeHTML(doc) {
        return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    }
    
    getFilename(url) {
        try {
            const urlObj = new URL(url);
            let filename = urlObj.hostname.replace(/\./g, '_');
            const date = new Date().toISOString().slice(0, 10);
            return `${filename}_${date}.html`;
        } catch {
            return `saved_page_${Date.now()}.html`;
        }
    }
    
    downloadHTML(html, filename) {
        try {
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            
            // 方案1: 使用 <a> 标签下载
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            
            // 触发点击
            a.click();
            
            // 延迟释放 URL 和移除元素
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 1000);
            
            console.log('下载已触发:', filename);
        } catch (error) {
            console.error('下载失败:', error);
            
            // 方案2: 使用 navigator.share（移动端）
            if (navigator.share) {
                const file = new File([html], filename, { type: 'text/html' });
                navigator.share({
                    files: [file],
                    title: filename
                }).catch(console.error);
            } else {
                // 方案3: 打开新窗口显示内容
                const newWindow = window.open('', '_blank');
                if (newWindow) {
                    newWindow.document.write(html);
                    newWindow.document.close();
                    this.showToast('请使用 Ctrl+S 保存页面', 'info');
                }
            }
        }
    }
}

// 初始化
let app;
document.addEventListener('DOMContentLoaded', async () => {
    app = new WebPageSaver();
});
