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
    
    async update(item) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(item);
            
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
        
        // 降级：估算已使用空间
        const all = await this.getAll();
        let totalSize = 0;
        for (const item of all) {
            if (item.content) {
                totalSize += new Blob([item.content]).size;
            }
        }
        
        return {
            usage: totalSize,
            quota: 100 * 1024 * 1024 // 假设 100MB
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
        
        // 当前预览的内容
        this.currentPreviewItem = null;
        
        // 使用 IndexedDB 存储
        this.storage = new StorageManager();
        
        // CORS代理列表（按优先级排序）
        this.corsProxies = [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?',
            'https://api.codetabs.com/v1/proxy?quest='
        ];
        
        this.currentProxyIndex = 0;
        
        // 初始化
        this.init();
    }
    
    async init() {
        // 初始化 IndexedDB
        try {
            await this.storage.init();
            console.log('IndexedDB 初始化成功');
        } catch (e) {
            console.error('IndexedDB 初始化失败:', e);
            this.showToast('存储初始化失败，请刷新页面重试', 'error');
        }
        
        // 保存按钮事件
        this.saveBtn.addEventListener('click', () => this.save());
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
        document.getElementById('downloadFromPreview').addEventListener('click', () => this.downloadCurrentPreview());
        
        // 点击遮罩关闭
        this.previewModal.addEventListener('click', (e) => {
            if (e.target === this.previewModal) this.closePreview();
        });
        
        // ESC关闭预览
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closePreview();
        });
        
        // 加载历史记录
        await this.renderHistory();
        await this.updateStorageInfo();
    }
    
    // 显示 Toast 提示
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
    
    // 历史记录管理
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
        
        // 搜索过滤（只过滤元数据，不加载内容）
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
            
            // 更新存储条
            const storageBarFill = document.querySelector('.storage-bar-fill');
            if (storageBarFill) {
                storageBarFill.style.width = `${percent}%`;
                // 根据使用率改变颜色
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
            
            // 使用 srcdoc 加载内容
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
    
    // 下载功能
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
            console.error('Download failed:', e);
            this.showToast('下载失败', 'error');
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
        try {
            const response = await this.fetchWithProxy(url);
            const blob = await response.blob();
            
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            console.warn(`Failed to fetch ${url}:`, error);
            return null;
        }
    }
    
    resolveUrl(base, relative) {
        try {
            return new URL(relative, base).href;
        } catch {
            return relative;
        }
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
        
        this.saveBtn.disabled = true;
        this.showProgress(true);
        this.updateProgress(0, '正在获取网页...');
        this.showStatus('处理中...', 'info');
        
        try {
            // 获取网页内容
            this.updateProgress(10, '正在获取网页HTML...');
            const response = await this.fetchWithProxy(url);
            let html = await response.text();
            
            // 解析HTML
            this.updateProgress(20, '正在解析HTML...');
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // 获取标题
            const title = doc.querySelector('title')?.textContent || url;
            
            // 获取选项
            const options = {
                inlineImages: document.getElementById('inlineImages').checked,
                inlineCSS: document.getElementById('inlineCSS').checked,
                inlineFonts: document.getElementById('inlineFonts').checked,
                removeScripts: document.getElementById('removeScripts').checked
            };
            
            // 处理基础URL
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
                await this.processImages(doc, baseUrl);
            }
            
            // 处理脚本
            if (options.removeScripts) {
                this.updateProgress(70, '正在移除脚本...');
                this.removeScripts(doc);
            }
            
            // 添加保存信息
            this.updateProgress(80, '正在生成文件...');
            this.addSaveInfo(doc, url);
            
            // 生成最终HTML
            this.updateProgress(90, '正在保存...');
            const finalHtml = this.serializeHTML(doc);
            const filename = this.getFilename(url);
            const size = new Blob([finalHtml]).size;
            
            // 检查文件大小
            const sizeMB = size / 1024 / 1024;
            if (sizeMB > 100) {
                throw new Error(`文件过大 (${sizeMB.toFixed(2)} MB)，超过 100MB 限制`);
            }
            
            // 保存到 IndexedDB
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
            
            // 下载文件
            this.updateProgress(100, '完成！');
            this.downloadHTML(finalHtml, filename);
            
            this.showStatus(`✅ 网页已成功保存！(${this.formatSize(size)})`, 'success');
            this.showToast(`网页保存成功！大小: ${this.formatSize(size)}`, 'success');
            
            // 清空输入
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
    
    async processStyles(doc, baseUrl, options) {
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
        const urlRegex = /url\(['"]?([^'"\)\s]+)['"]?\)/g;
        const urls = css.matchAll(urlRegex);
        const replacements = [];
        
        for (const match of urls) {
            const resourceUrl = match[1];
            const absoluteUrl = this.resolveUrl(baseUrl, resourceUrl);
            
            const isFont = this.isFontUrl(resourceUrl);
            const isImage = this.isImageUrl(resourceUrl);
            
            if ((isFont && options.inlineFonts) || (isImage && options.inlineImages)) {
                const base64 = await this.fetchAsBase64(absoluteUrl);
                if (base64) {
                    replacements.push({
                        original: match[0],
                        replacement: `url(${base64})`
                    });
                }
            }
        }
        
        for (const { original, replacement } of replacements) {
            css = css.replace(original, replacement);
        }
        
        return css;
    }
    
    isFontUrl(url) {
        return /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url);
    }
    
    isImageUrl(url) {
        return /\.(png|jpe?g|gif|webp|svg|ico|bmp)(\?|$)/i.test(url);
    }
    
    async processImages(doc, baseUrl) {
        const images = doc.querySelectorAll('img[src]');
        
        for (const img of images) {
            const src = img.getAttribute('src');
            if (!src || src.startsWith('data:')) continue;
            
            const absoluteUrl = this.resolveUrl(baseUrl, src);
            const base64 = await this.fetchAsBase64(absoluteUrl);
            
            if (base64) {
                img.setAttribute('src', base64);
            }
        }
        
        for (const img of doc.querySelectorAll('img[srcset]')) {
            const srcset = img.getAttribute('srcset');
            const newSrcset = await this.processSrcset(srcset, baseUrl);
            if (newSrcset) {
                img.setAttribute('srcset', newSrcset);
            }
        }
        
        const sources = doc.querySelectorAll('source[srcset]');
        for (const source of sources) {
            const srcset = source.getAttribute('srcset');
            const newSrcset = await this.processSrcset(srcset, baseUrl);
            if (newSrcset) {
                source.setAttribute('srcset', newSrcset);
            }
        }
    }
    
    async processSrcset(srcset, baseUrl) {
        const parts = srcset.split(',').map(p => p.trim());
        const newParts = [];
        
        for (const part of parts) {
            const [url, descriptor] = part.split(/\s+/);
            const absoluteUrl = this.resolveUrl(baseUrl, url);
            const base64 = await this.fetchAsBase64(absoluteUrl);
            
            if (base64) {
                newParts.push(descriptor ? `${base64} ${descriptor}` : base64);
            } else {
                newParts.push(part);
            }
        }
        
        return newParts.join(', ');
    }
    
    removeScripts(doc) {
        doc.querySelectorAll('script').forEach(el => el.remove());
        
        doc.querySelectorAll('[onclick],[onload],[onerror],[onmouseover],[onmouseout]').forEach(el => {
            el.removeAttribute('onclick');
            el.removeAttribute('onload');
            el.removeAttribute('onerror');
            el.removeAttribute('onmouseover');
            el.removeAttribute('onmouseout');
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
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
    }
}

// 初始化
let app;
document.addEventListener('DOMContentLoaded', async () => {
    app = new WebPageSaver();
});
