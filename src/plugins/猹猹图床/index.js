(function() {
    'use strict';

    const CONFIG = {
        TARGET_KEY: 'file_upload.php',
        NEW_API: 'https://img.scdn.io/api/v1.php',
        CDN_DOMAIN: 'https://anycastimg.scdn.io',
        FORMAT: 'auto',
        ORIGINAL_PREFIX: 'http://r.iirose.com/'
    };

    let useCDN = localStorage.getItem('upload_mode_cdn') === 'true';

    const style = document.createElement('style');
    style.innerHTML = `
        :root {
            --cap-w: clamp(70px, 11vw, 95px);
            --cap-h: clamp(30px, 4.5vh, 38px);
            --cap-f: clamp(10px, 1.4vw, 12px);
            --cap-visible: 18px; 
        }

        #custom-ui-capsule {
            position: fixed; 
            right: 0;
            bottom: 5%;
            z-index: 99999;
            width: var(--cap-w);             
            height: var(--cap-h);
            background: rgba(0, 0, 0, 0.15); 
            border-radius: 100px 0 0 100px; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            cursor: pointer; 
            border: none;
            color: white;
            user-select: none;
            transform: translateX(calc(var(--cap-w) - var(--cap-visible))); 
            transition: transform 0.4s cubic-bezier(0.2, 0, 0.2, 1), background 0.4s;
            backdrop-filter: blur(2px);
        }

        #custom-ui-capsule::after {
            content: '';
            position: absolute;
            top: -6px;
            left: -6px;
            right: -6px;
            bottom: -6px;
            background: transparent;
        }
        
        #custom-ui-capsule:hover { 
            transform: translateX(0);
            background: rgba(0, 0, 0, 0.5);
        }

        #custom-ui-capsule .mode-text {
            font-size: var(--cap-f);
            font-weight: 500;
            letter-spacing: 0.5px;
            white-space: nowrap;
            opacity: 0.2;
            transition: opacity 0.4s;
            width: 100%;
            text-align: center;
            padding-left: 8px;
        }

        #custom-ui-capsule:hover .mode-text { 
            opacity: 0.9; 
            padding-left: 0;
        }
    `;
    document.head.appendChild(style);

    const capsule = document.createElement('div');
    capsule.id = 'custom-ui-capsule';
    capsule.innerHTML = `<div class="mode-text">${useCDN ? 'scdn' : 'iirose'}</div>`;
    document.body.appendChild(capsule);

    capsule.onclick = (e) => {
        e.stopPropagation();
        useCDN = !useCDN;
        localStorage.setItem('upload_mode_cdn', useCDN);
        capsule.querySelector('.mode-text').innerText = useCDN ? 'scdn' : 'iirose';
        updatePrefix();
    };

    const updatePrefix = () => {
        const target = window.Constant || (typeof Constant !== 'undefined' ? Constant : null);
        if (target && target.URL) {
            target.URL.uploadedPrefixImg = useCDN ? '' : CONFIG.ORIGINAL_PREFIX;
        }
    };
    setInterval(updatePrefix, 2000);
    updatePrefix();

    const _open = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url) {
        if (typeof url === 'string' && url.includes(CONFIG.TARGET_KEY)) this._isTarget = true;
        return _open.apply(this, arguments);
    };

    const _send = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.send = function(data) {
        const xhr = this;
        if (useCDN && this._isTarget && data instanceof FormData) {
            const file = data.get('file') || [...data.values()].find(v => v instanceof File);
            const fd = new FormData();
            fd.append('image', file);
            fd.append('outputFormat', CONFIG.FORMAT);
            fd.append('cdn_domain', CONFIG.CDN_DOMAIN);
            fetch(CONFIG.NEW_API, { method: "POST", body: fd, mode: 'cors' })
                .then(res => res.json())
                .then(json => {
                    if (json.success && json.url) {
                        const finalUrl = json.url.includes('#e') ? json.url : json.url + '#e'; 
                        Object.defineProperties(xhr, {
                            readyState: { value: 4, configurable: true },
                            status: { value: 200, configurable: true },
                            responseText: { value: finalUrl, configurable: true },
                            response: { value: finalUrl, configurable: true }
                        });
                        xhr.dispatchEvent(new Event('readystatechange'));
                        xhr.dispatchEvent(new Event('load'));
                        xhr.dispatchEvent(new Event('loadend'));
                    }
                }).catch(() => {});
            return;
        }
        if (!useCDN && this._isTarget) {
            const originalOnReadyStateChange = xhr.onreadystatechange;
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4 && xhr.status === 200) {
                    let rawResponse = xhr.responseText;
                    if (rawResponse && !rawResponse.includes('#e')) {
                        const newResponse = rawResponse + '#e';
                        Object.defineProperties(xhr, {
                            responseText: { value: newResponse, configurable: true },
                            response: { value: newResponse, configurable: true }
                        });
                    }
                }
                if (originalOnReadyStateChange) originalOnReadyStateChange.apply(this, arguments);
            };
        }
        return _send.apply(this, arguments);
    };
})();
