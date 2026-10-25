package com.gunter.mobile

import org.json.JSONObject

/** Installed before document scripts, only in the explicitly trusted main-frame origin. */
object WebExportScript {
    const val BRIDGE = "GunterFileExport"
    fun source(origin: String): String = """
        (() => {
          'use strict';
          const ORIGIN = ${JSONObject.quote(origin)};
          if (window.top !== window || location.origin !== ORIGIN || window.__gunterFileExportInstalled || !window.GunterFileExport) return;
          Object.defineProperty(window, '__gunterFileExportInstalled', {value:true});
          const bridge = window.GunterFileExport, MAX = 52428800, CHUNK = 24576;
          const blobs = new Map(); let held = 0, current = null;
          const post = value => bridge.postMessage(JSON.stringify(value));
          const signal = state => window.dispatchEvent(new CustomEvent('gunterandroidexportstate', {detail:{state:state}}));
          function cancel() {
            const old = current; current = null;
            if (old && old.reject) old.reject(new Error('export_cancelled'));
          }
          function drop(url) { const blob = blobs.get(url); if (blob) held -= blob.size; blobs.delete(url); }
          const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
          URL.createObjectURL = function(blob) {
            const url = create.apply(this, arguments);
            if (blob instanceof Blob && blob.size <= MAX) {
              while (blobs.size && (held + blob.size > MAX || blobs.size >= 8)) drop(blobs.keys().next().value);
              blobs.set(url, blob); held += blob.size;
            }
            return url;
          };
          URL.revokeObjectURL = function(url) { drop(String(url)); return revoke.apply(this, arguments); };
          function id() {
            const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
            return Array.from(bytes, n => n.toString(16).padStart(2,'0')).join('');
          }
          async function offer(blob, name) {
            if (current || !(blob instanceof Blob) || blob.size > MAX) { signal('rejected'); return; }
            const item = {id:id(), blob:blob, seq:0, offset:0, resolve:null, reject:null}; current = item;
            post({type:'begin',id:item.id,name:name || 'archivo-gunter.txt',mime:blob.type || '',size:String(blob.size)});
            signal('awaiting-confirmation');
          }
          async function pump(item) {
            try {
              while (current === item && item.offset < item.blob.size) {
                const bytes = new Uint8Array(await item.blob.slice(item.offset, item.offset + CHUNK).arrayBuffer());
                if (current !== item) return;
                let binary = ''; for (let i=0;i<bytes.length;i++) binary += String.fromCharCode(bytes[i]);
                await new Promise((resolve,reject) => {
                  item.resolve = resolve; item.reject = reject;
                  post({type:'chunk',id:item.id,seq:item.seq,data:btoa(binary)});
                });
                item.offset += bytes.length; item.seq++;
              }
              if (current === item) post({type:'end',id:item.id,seq:item.seq});
            } catch (_) {
              if (current === item) { post({type:'cancel',id:item.id}); cancel(); signal('cancelled'); }
            }
          }
          bridge.onmessage = event => {
            let message; try { message = JSON.parse(event.data); } catch (_) { return; }
            const item = current; if (!item || message.id !== item.id) return;
            if (message.type === 'start') pump(item);
            else if (message.type === 'ack' && message.seq === item.seq && item.resolve) {
              const resolve = item.resolve; item.resolve = null; item.reject = null; resolve();
            } else if (message.type === 'prepared') { current = null; signal('prepared-not-saved'); }
            else if (message.type === 'cancel') { cancel(); signal('cancelled'); }
          };
          function intercept(anchor) {
            if (!anchor || !anchor.hasAttribute('download')) return false;
            const address = String(anchor.href || ''), name = String(anchor.download || '').slice(0,120);
            if (address.startsWith('blob:')) {
              let url; try { url = new URL(address); } catch (_) { return false; }
              if (url.origin !== ORIGIN || !blobs.has(address)) return false;
              const blob = blobs.get(address); offer(blob,name); return true;
            }
            if (address.startsWith('data:')) {
              if (address.length > 69906100 || !/^data:[^,]*,/.test(address)) { signal('rejected'); return true; }
              fetch(address).then(r => r.blob()).then(blob => offer(blob,name)).catch(() => signal('rejected'));
              return true;
            }
            return false;
          }
          const click = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function() { if (!intercept(this)) return click.apply(this, arguments); };
          const dispatch = HTMLAnchorElement.prototype.dispatchEvent;
          HTMLAnchorElement.prototype.dispatchEvent = function(event) {
            if (event && event.type === 'click' && intercept(this)) { event.preventDefault(); return false; }
            return dispatch.apply(this, arguments);
          };
          document.addEventListener('click', event => {
            const target = event.target instanceof Element ? event.target.closest('a[download]') : null;
            if (intercept(target)) event.preventDefault();
          }, true);
          window.addEventListener('pagehide', () => { if (current) post({type:'cancel',id:current.id}); cancel(); blobs.clear(); held=0; });
        })();
    """.trimIndent()
}
