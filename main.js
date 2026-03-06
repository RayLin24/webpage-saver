/**
 * WebPage Saver - 网页保存工具
 * 将任意网页保存为单个HTML文件，支持历史记录、预览和下载
 * 使用 IndexedDB 支持大文件存储（限制 10MB）
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
        
        this.currentPreviewItem = null;
        this.storage = new StorageManager();
        
        // CORS代理列表（按成功率排序）
        this.corsProxies = [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?',
            'https://api.codetabs.com/v1/proxy?quest='
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
            console.error('IndexedDB 初始化失败:', e);
            this.showToast('存储初始化失败', 'error');
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
            this.showToast('保存失败: ' + e.message, 'error');
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
        if (this.currentPreviewItem) await this.download(this.currentPreviewItem.id);
    }
    
    async download(id) {
        try {
            const item = await this.storage.get(id);
            if (!item) {
                this.showToast('记录不存在', 'error');
                return;
            }
            this.downloadHTML(item.content, item.filename);
            this.showToast('下载已开始', 'success');
        } catch (e) {
            this.showToast('下载失败: ' + e.message, 'error');
        }
    }
    
    async fetchWithProxy(url) {
        let lastError;
        for (let i = 0; i < this.corsProxies.length; i++) {
            const proxyIndex = (this.currentProxyIndex + i) % this.corsProxies.length;
            const proxy = this.corsProxies[proxyIndex];
            try {
                const response = await fetch(proxy + encodeURIComponent(url));
                if (response.ok) {
                    this.currentProxyIndex = proxyIndex;
                    return response;
                }
            } catch (error) {
                lastError = error;
            }
        }
        throw new Error(`所有代理失败: ${lastError?.message}`);
    }
    
    async fetchAsBase64(url) {
        if (this.resourceCache.has(url)) return this.resourceCache.get(url);
        
        let lastError;
        for (let i = 0; i < this.corsProxies.length; i++) {
            const proxyIndex = (this.currentProxyIndex + i) % this.corsProxies.length;
            const proxy = this.corsProxies[proxyIndex];
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                
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
                this.currentProxyIndex = proxyIndex;
                return base64;
                
            } catch (error) {
                lastError = error;
                continue;
            }
        }
        
        console.warn('图片下载失败:', url, lastError?.message);
        return null;
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
        
        this.stats = { imagesProcessed: 0, imagesSuccess: 0, imagesFailed: 0 };
        this.resourceCache.clear();
        
        this.saveBtn.disabled = true;
        this.showProgress(true);
        this.updateProgress(0, '正在获取网页...');
        
        try {
            this.updateProgress(10, '正在获取HTML...');
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
            if (baseTag) baseUrl = this.resolveUrl(url, baseTag.getAttribute('href'));
            
            if (options.inlineCSS) {
                this.updateProgress(30, '正在处理CSS...');
                await this.processStyles(doc, baseUrl, options);
            }
            
            if (options.inlineImages) {
                this.updateProgress(50, '正在处理图片...');
                await this.processAllImages(doc, baseUrl);
            }
            
            if (options.removeScripts) {
                this.updateProgress(80, '正在移除脚本...');
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
            this.downloadHTML(finalHtml, filename);
            
            const imgInfo = this.stats.imagesProcessed > 0 
                ? ` (图片: ${this.stats.imagesSuccess}/${this.stats.imagesProcessed})` : '';
            this.showStatus(`✅ 保存成功！(${this.formatSize(size)})${imgInfo}`, 'success');
            this.showToast('保存成功！', 'success');
            
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
    
    async processAllImages(doc, baseUrl) {
        // 1. 处理所有 <img> 标签
        const images = doc.querySelectorAll('img');
        const total = images.length;
        let processed = 0;
        
        for (const img of images) {
            processed++;
            if (processed % 5 === 0) {
                this.updateProgress(50 + (processed / total) * 25, `处理图片 ${processed}/${total}...`);
            }
            
            await this.processSingleImage(img, baseUrl);
        }
        
        // 2. 处理内联样式背景图
        await this.processInlineStyleImages(doc, baseUrl);
        
        // 3. 处理 <picture> 和 <source>
        await this.processPictureElements(doc, baseUrl);
        
        console.log(`图片处理完成: ${this.stats.imagesSuccess}/${this.stats.imagesProcessed}`);
    }
    
    async processSingleImage(img, baseUrl) {
        // 收集所有可能的图片源
        const sources = [];
        
        // 1. data-src 等懒加载属性（优先）
        const lazyAttrs = ['data-src', 'data-original', 'data-lazy-src', 'data-lazyload', 
                          'data-image', 'data-srcset', 'data-nimg'];
        for (const attr of lazyAttrs) {
            const val = img.getAttribute(attr);
            if (val && !val.startsWith('data:')) {
                // 处理 srcset 格式
                const url = val.split(/[\s,]+/)[0];
                sources.push({ url, priority: 1 });
            }
        }
        
        // 2. src 属性
        const src = img.getAttribute('src');
        if (src && !src.startsWith('data:')) {
            sources.push({ url: src, priority: 2 });
        }
        
        // 3. srcset 属性
        const srcset = img.getAttribute('srcset');
        if (srcset) {
            const url = srcset.split(',')[0].trim().split(/\s+/)[0];
            if (url && !url.startsWith('data:')) {
                sources.push({ url, priority: 1 });
            }
        }
        
        // 按优先级排序
        sources.sort((a, b) => a.priority - b.priority);
        
        // 尝试下载图片
        for (const { url } of sources) {
            let finalUrl = url;
            
            // 处理 Next.js 图片 URL
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
                img.setAttribute('src', base64);
                // 清除所有懒加载属性
                lazyAttrs.forEach(attr => img.removeAttribute(attr));
                img.removeAttribute('srcset');
                img.removeAttribute('loading');
                this.stats.imagesSuccess++;
                return; // 成功则退出
            } else {
                this.stats.imagesFailed++;
            }
        }
    }
    
    async processInlineStyleImages(doc, baseUrl) {
        const elements = doc.querySelectorAll('[style*="url("]');
        
        for (const el of elements) {
            let style = el.getAttribute('style');
            if (!style) continue;
            
            const matches = style.matchAll(/url\(\s*['"]?([^'"\)\s]+)['"]?\s*\)/gi);
            
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
    }
    
    async processPictureElements(doc, baseUrl) {
        const sources = doc.querySelectorAll('source[srcset], source[src]');
        
        for (const source of sources) {
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
        }
    }
    
    async processStyles(doc, baseUrl, options) {
        // 处理外部样式表
        const links = doc.querySelectorAll('link[rel="stylesheet"]');
        for (const link of links) {
            try {
                const href = link.getAttribute('href');
                if (!href) continue;
                
                const absoluteUrl = this.resolveUrl(baseUrl, href);
                const response = await this.fetchWithProxy(absoluteUrl);
                let css = await response.text();
                
                // 处理 CSS 中的图片
                if (options.inlineImages) {
                    css = await this.processCSSUrls(css, absoluteUrl);
                }
                
                const style = doc.createElement('style');
                style.textContent = css;
                link.replaceWith(style);
            } catch (e) {
                console.warn('CSS 处理失败:', e);
            }
        }
        
        // 处理内联样式
        const styles = doc.querySelectorAll('style');
        for (const style of styles) {
            let css = style.textContent;
            if (options.inlineImages) {
                css = await this.processCSSUrls(css, baseUrl);
            }
            style.textContent = css;
        }
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
    
    removeScripts(doc) {
        doc.querySelectorAll('script').forEach(el => el.remove());
        doc.querySelectorAll('noscript').forEach(el => el.remove());
        
        const eventAttrs = ['onclick', 'onload', 'onerror', 'onmouseover', 'onmouseout'];
        doc.querySelectorAll('[' + eventAttrs.join('],[') + ']').forEach(el => {
            eventAttrs.forEach(attr => el.removeAttribute(attr));
        });
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
    
    downloadHTML(html, filename) {
        // 确保 filename 以 .html 结尾
        if (!filename.endsWith('.html')) {
            filename += '.html';
        }
        
        try {
            // 方法1: 使用 Blob + URL.createObjectURL
            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            
            // 延迟释放
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
            
            console.log('下载已触发:', filename);
            
        } catch (e) {
            console.error('下载失败:', e);
            
            // 方法2: 使用 data URI
            try {
                const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            } catch (e2) {
                // 方法3: 打开新窗口让用户手动保存
                const win = window.open('', '_blank');
                if (win) {
                    win.document.write(html);
                    win.document.close();
                    this.showToast('请使用 Ctrl+S 保存页面', 'info');
                }
            }
        }
    }
}

let app;
document.addEventListener('DOMContentLoaded', async () => {
    app = new WebPageSaver();
});
