/**
 * WebPage Saver - 网页保存工具
 * 将任意网页保存为单个HTML文件
 */

class WebPageSaver {
    constructor() {
        this.urlInput = document.getElementById('url');
        this.saveBtn = document.getElementById('saveBtn');
        this.statusDiv = document.getElementById('status');
        this.progressDiv = document.getElementById('progress');
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');
        
        // CORS代理列表（按优先级排序）
        this.corsProxies = [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?',
            'https://api.codetabs.com/v1/proxy?quest='
        ];
        
        this.currentProxyIndex = 0;
        this.init();
    }
    
    init() {
        this.saveBtn.addEventListener('click', () => this.save());
        this.urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.save();
        });
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
                    // 记住成功的代理
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
            this.updateProgress(90, '正在准备下载...');
            const finalHtml = this.serializeHTML(doc);
            
            // 下载文件
            this.updateProgress(100, '完成！');
            this.downloadHTML(finalHtml, this.getFilename(url));
            
            this.showStatus('✅ 网页已成功保存！', 'success');
            
        } catch (error) {
            console.error('Save failed:', error);
            this.showStatus(`❌ 保存失败: ${error.message}`, 'error');
        } finally {
            this.saveBtn.disabled = false;
            setTimeout(() => this.showProgress(false), 2000);
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
                
                // 创建 style 标签替换 link
                const style = doc.createElement('style');
                style.textContent = css;
                link.replaceWith(style);
            } catch (error) {
                console.warn('Failed to process stylesheet:', error);
            }
        }
        
        // 处理内联 <style> 中的 @import 和 url()
        const styles = doc.querySelectorAll('style');
        for (const style of styles) {
            let css = style.textContent;
            
            // 处理 @import
            css = await this.processCSSImports(css, baseUrl);
            
            // 处理 url() 中的资源
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
            
            // 判断是否需要处理
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
        
        // 处理 srcset
        for (const img of doc.querySelectorAll('img[srcset]')) {
            const srcset = img.getAttribute('srcset');
            const newSrcset = await this.processSrcset(srcset, baseUrl);
            if (newSrcset) {
                img.setAttribute('srcset', newSrcset);
            }
        }
        
        // 处理 picture source
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
        // 移除 script 标签
        doc.querySelectorAll('script').forEach(el => el.remove());
        
        // 移除事件处理器
        doc.querySelectorAll('[onclick],[onload],[onerror],[onmouseover],[onmouseout]').forEach(el => {
            el.removeAttribute('onclick');
            el.removeAttribute('onload');
            el.removeAttribute('onerror');
            el.removeAttribute('onmouseover');
            el.removeAttribute('onmouseout');
        });
        
        // 移除 noscript 标签
        doc.querySelectorAll('noscript').forEach(el => el.remove());
    }
    
    addSaveInfo(doc, originalUrl) {
        // 添加保存信息注释
        const comment = doc.createComment(`
    Saved by WebPage Saver
    Original URL: ${originalUrl}
    Saved at: ${new Date().toISOString()}
    `);
        doc.documentElement.insertBefore(comment, doc.documentElement.firstChild);
        
        // 更新 title
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
document.addEventListener('DOMContentLoaded', () => {
    new WebPageSaver();
});
