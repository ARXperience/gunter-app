/* Localized Gunter hologram: original Stitch geometry, camera and orbital interaction.
 * Three.js r125 is vendored locally. Nothing is drawn on the page background. */
(function () {
    'use strict';
    if (window.GunterParticles) return;
    const sourceURL = document.currentScript?.src || new URL('js/services/gunter-particles.js', location.href).href;
    const libraryURL = new URL('../../assets/vendor/three-r125.min.js', sourceURL).href;
    const records = new Map(), pending = new WeakSet();
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let libraryPromise, raf = 0, lastFrame = 0, disposed = false;

    function loadThree() {
        if (window.THREE?.WebGLRenderer) return Promise.resolve(window.THREE);
        if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = libraryURL; script.async = true;
            script.onload = () => window.THREE?.WebGLRenderer ? resolve(window.THREE) : reject(new Error('Renderer unavailable'));
            script.onerror = () => reject(new Error('Renderer unavailable'));
            document.head.appendChild(script);
        });
        return libraryPromise;
    }

    const visibilityObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
        for (const entry of entries) {
            const record = records.get(entry.target);
            if (record) { record.visible = entry.isIntersecting; record.dirty = true; }
        }
        schedule();
    }, { rootMargin: '40px' }) : null;
    function isLight() { return document.body.classList.contains('at-light') || document.documentElement.dataset.colorMode === 'light'; }

    function buildGeometry(THREE, variant) {
        const hero = variant === 'hero', penguinCount = hero ? 2400 : variant === 'chat' ? 1200 : 800;
        const cyan = new THREE.Color(0x55c6d5), deep = new THREE.Color(0x268da9);
        const turquoise = new THREE.Color(0x2dd4bf), electric = new THREE.Color(0x95edee), white = new THREE.Color(0xffffff);
        const rings = [
            { radius: 3.8, y: 1.2, count: 420, speed: .65, color: white, ticks: true, tiltX: .1, tiltZ: -.05 },
            { radius: 5.6, y: 0, count: 680, speed: -.45, color: electric, ticks: true, tiltX: -.15, tiltZ: .12 },
            { radius: 7.8, y: -1, count: 780, speed: .38, color: cyan, ticks: true, tiltX: .18, tiltZ: -.2 },
            { radius: 9.8, y: .6, count: 680, speed: -.28, color: turquoise, ticks: false, tiltX: -.08, tiltZ: .15 },
            { radius: 12, y: -.5, count: 640, speed: .22, color: deep, ticks: true, tiltX: .05, tiltZ: -.08 }
        ].slice(0, hero ? 5 : variant === 'chat' ? 2 : 1);
        if (!hero) rings.forEach(ring => { ring.count = Math.round(ring.count * .3); });
        const count = penguinCount + (hero ? 3200 : rings.reduce((sum, ring) => sum + ring.count, 0));
        const positions = new Float32Array(count * 3), base = new Float32Array(count * 3), velocities = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3), baseColors = new Float32Array(count * 3);
        const speeds = new Float32Array(count);
        let index = 0;
        function add(x, y, z, color, speed = 0) {
            const p = index * 3;
            positions[p] = base[p] = x; positions[p + 1] = base[p + 1] = y; positions[p + 2] = base[p + 2] = z;
            colors[p] = baseColors[p] = color.r; colors[p + 1] = baseColors[p + 1] = color.g; colors[p + 2] = baseColors[p + 2] = color.b;
            speeds[index] = speed; index++;
        }
        for (let i = 0; i < penguinCount; i++) {
            let x, y, z, color;
            const part = Math.random();
            if (part < .44) {
                const theta = Math.random() * Math.PI * 2, phi = Math.acos(Math.random() * 2 - 1);
                x = 2.1 * Math.sin(phi) * Math.cos(theta) * (.85 + .15 * Math.random());
                y = 3.5 * Math.cos(phi) - .2; z = 1.6 * Math.sin(phi) * Math.sin(theta) * (.85 + .15 * Math.random());
                color = Math.random() > .4 ? cyan : white;
            } else if (part < .68) {
                const theta = Math.random() * Math.PI * 2, phi = Math.acos(Math.random() * 2 - 1), radius = 1.5 * (.88 + .12 * Math.random());
                x = radius * Math.sin(phi) * Math.cos(theta) * .92;
                y = 3.3 + radius * Math.cos(phi) * .95; z = radius * Math.sin(phi) * Math.sin(theta) * .88;
                color = Math.random() > .5 ? white : electric;
            } else if (part < .88) {
                const side = Math.random() > .5 ? 1 : -1, t = Math.random();
                x = side * (1.9 + t * 1.5 + (Math.random() - .5) * .3); y = 1.9 - t * 3.8; z = (Math.random() - .5) * .5; color = turquoise;
            } else if (part < .94) {
                const t = Math.random();
                x = (Math.random() - .5) * .4 * (1 - t); y = 3.2 - t * .45; z = 1.35 + t * 1.5; color = white;
            } else {
                const side = Math.random() > .5 ? 1 : -1;
                x = side * (1 + Math.random() * .7); y = -3.8 + (Math.random() - .5) * .4; z = Math.random() - .5; color = deep;
            }
            add(x, y, z, color);
        }
        // Preserve the five isometric planes, dense tick marks, and 3,200 ring points in the source.
        for (const ring of rings) for (let k = 0; k < ring.count && index < count; k++) {
            const angle = k / ring.count * Math.PI * 2, tick = ring.ticks && k % 6 === 0;
            const radius = ring.radius + (tick ? (Math.random() - .5) * .4 : 0) + (Math.random() - .5) * .2;
            const x = radius * Math.cos(angle), y = ring.y + (Math.random() - .5) * .2, z = radius * Math.sin(angle);
            const tiltedY = y * Math.cos(ring.tiltX) - z * Math.sin(ring.tiltX), tiltedZ = y * Math.sin(ring.tiltX) + z * Math.cos(ring.tiltX);
            add(x * Math.cos(ring.tiltZ) - tiltedY * Math.sin(ring.tiltZ), x * Math.sin(ring.tiltZ) + tiltedY * Math.cos(ring.tiltZ),
                tiltedZ, tick ? white : ring.color, ring.speed);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setDrawRange(0, index);
        return { geometry, positions, base, velocities, colors, baseColors, speeds, penguinCount, count: index };
    }

    function makeTexture(THREE) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const context = canvas.getContext('2d'), glow = context.createRadialGradient(32, 32, 0, 32, 32, 32);
        glow.addColorStop(0, 'rgba(255,255,255,1)'); glow.addColorStop(.25, 'rgba(149,237,238,.95)');
        glow.addColorStop(.65, 'rgba(38,141,169,.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
        context.fillStyle = glow; context.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(canvas);
    }
    function applyPalette(record) {
        record.light = isLight();
        record.material.blending = record.light ? record.THREE.NormalBlending : record.THREE.AdditiveBlending;
        record.material.needsUpdate = true; record.dirty = true;
        record.themeColors = Float32Array.from(record.figure.baseColors, (component, i) => {
            if (!record.light) return component;
            // Dark teal pigments keep the cloud visible on light surfaces, without a black tile.
            return i % 3 === 0 ? .025 + component * .05 : i % 3 === 1 ? .16 + component * .22 : .22 + component * .23;
        });
    }
    function listen(record, element, type, handler, passive = true) {
        element.addEventListener(type, handler, { passive });
        record.listeners.push(() => element.removeEventListener(type, handler));
    }
    // A static projection of the very same 3D geometry covers devices with WebGL disabled.
    // It deliberately has no alternative silhouette and no continuously running software loop.
    function softwareRenderer(canvas, THREE) {
        const context = canvas.getContext('2d');
        if (!context) return null;
        let width = 1, height = 1, ratio = 1;
        const vertex = new THREE.Vector3(), projected = new THREE.Vector3();
        return {
            isSoftwareRenderer: true,
            setPixelRatio(value) { ratio = value; },
            setClearColor() {},
            setSize(w, h) { width = w; height = h; canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); },
            render(scene, camera) {
                scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
                context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
                context.globalCompositeOperation = isLight() ? 'source-over' : 'lighter';
                const mesh = scene.children[0].children[0];
                const position = mesh.geometry.attributes.position.array, colors = mesh.geometry.attributes.color.array;
                for (let i = 0; i < mesh.geometry.drawRange.count; i++) {
                    const p = i * 3;
                    vertex.set(position[p], position[p + 1], position[p + 2]).applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
                    if (vertex.z >= -.1) continue;
                    projected.copy(vertex).applyMatrix4(camera.projectionMatrix);
                    if (Math.abs(projected.x) > 1.04 || Math.abs(projected.y) > 1.04) continue;
                    const x = (projected.x + 1) * width / 2, y = (1 - projected.y) * height / 2;
                    const radius = Math.max(.35, mesh.material.size * height / (-vertex.z * 4));
                    context.fillStyle = 'rgb(' + Math.round(colors[p] * 255) + ',' + Math.round(colors[p + 1] * 255) + ',' + Math.round(colors[p + 2] * 255) + ')';
                    context.globalAlpha = .12; context.beginPath(); context.arc(x, y, radius * 2, 0, Math.PI * 2); context.fill();
                    context.globalAlpha = .78; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
                }
                context.globalAlpha = 1;
            },
            dispose() {},
            forceContextLoss() {}
        };
    }
    function createRecord(el, THREE) {
        const variant = el.dataset.gunterParticles || 'thumb';
        let canvas = document.createElement('canvas');
        let renderer;
        try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' }); }
        catch (_) { canvas = document.createElement('canvas'); renderer = softwareRenderer(canvas, THREE); }
        if (!renderer) return null;
        canvas.className = 'gunter-particle-art__canvas'; canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'display:block;width:100%;height:100%;';
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, variant === 'hero' ? 1.75 : 2)); renderer.setClearColor(0x000000, 0);
        const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, .1, 1000);
        camera.position.set(0, 13, 23); camera.lookAt(0, 0, 0);
        camera.zoom = variant === 'hero' ? 1 : variant === 'chat' ? 1.75 : 2.15;
        const group = new THREE.Group(); group.rotation.set(.52, -.42, 0); scene.add(group);
        const figure = buildGeometry(THREE, variant), texture = makeTexture(THREE);
        const material = new THREE.PointsMaterial({ size: variant === 'hero' ? .36 : .43, vertexColors: true,
            map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
        const points = new THREE.Points(figure.geometry, material); points.frustumCulled = false; group.add(points);
        const record = { el, THREE, variant, canvas, renderer, scene, camera, group, figure, texture, material, visible: !visibilityObserver,
            dirty: true, elapsed: 0, spin: 0, hover: 0, active: false, mouseX: 0, mouseY: 0, targetX: 0, targetY: 0,
            contextLost: false, listeners: [], width: 0, height: 0 };
        records.set(el, record); el.replaceChildren(canvas); el.classList.add('gunter-particle-art');
        el.dataset.particlesReady = 'true'; el.dataset.particlesRenderer = renderer.isSoftwareRenderer ? 'static-3d' : 'webgl'; applyPalette(record);
        const resize = () => {
            const box = el.getBoundingClientRect(); record.width = box.width; record.height = box.height;
            if (box.width <= 0 || box.height <= 0) return;
            camera.aspect = box.width / box.height; camera.updateProjectionMatrix(); renderer.setSize(box.width, box.height, false);
            record.dirty = true; schedule();
        };
        if ('ResizeObserver' in window) { record.resizeObserver = new ResizeObserver(resize); record.resizeObserver.observe(el); }
        else listen(record, window, 'resize', resize);
        if (variant === 'hero' && !renderer.isSoftwareRenderer) {
            const updatePointer = event => {
                if (reducedMotion.matches) return;
                const box = el.getBoundingClientRect();
                if (!box.width || !box.height) return;
                record.targetX = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1)) * 14;
                record.targetY = -Math.max(-1, Math.min(1, (event.clientY - box.top) / box.height * 2 - 1)) * 12;
                record.active = true; schedule();
            };
            listen(record, el, 'pointermove', updatePointer);
            listen(record, el, 'pointerdown', updatePointer);
            const resetPointer = () => { record.active = false; record.targetX = record.targetY = 0; schedule(); };
            listen(record, el, 'pointerleave', resetPointer); listen(record, el, 'pointercancel', resetPointer);
            listen(record, el, 'pointerup', event => { if (event.pointerType !== 'mouse') resetPointer(); });
        }
        listen(record, canvas, 'webglcontextlost', event => { event.preventDefault(); record.contextLost = true; }, false);
        listen(record, canvas, 'webglcontextrestored', () => { record.contextLost = false; record.dirty = true; schedule(); });
        visibilityObserver?.observe(el); resize(); schedule(); return record;
    }

    function render(record, dt) {
        const motion = !reducedMotion.matches, step = motion ? Math.min(dt * 60, 2) : 0;
        if (motion) record.elapsed += dt;
        const smooth = 1 - Math.pow(.92, step || 1);
        record.mouseX += (record.targetX - record.mouseX) * smooth; record.mouseY += (record.targetY - record.mouseY) * smooth;
        record.hover += ((record.active && motion ? 1 : 0) - record.hover) * (1 - Math.pow(.94, step || 1));
        const hover = motion ? record.hover : 0, t = record.elapsed;
        record.group.rotation.y = -.42 + (motion ? Math.sin(t * .3) * .05 + record.mouseX * .02 : 0);
        record.group.rotation.x = .52 + (motion ? Math.cos(t * .25) * .03 - record.mouseY * .02 : 0);
        // Integrate speed: changing hover state never makes the rings jump back in time.
        if (motion) record.spin += dt * (1 + hover * 4.2);
        const f = record.figure;
        for (let i = 0; i < f.count; i++) {
            const p = i * 3;
            if (i >= f.penguinCount) {
                // The base point already contains its azimuth. Rotate the entire plane by one
                // shared angle; adding the azimuth again folds a tilted ring over itself.
                const angle = record.spin * f.speeds[i], cos = Math.cos(angle), sin = Math.sin(angle);
                const pulse = motion ? 1 + .02 * Math.sin(t * 4 + i) : 1;
                f.positions[p] = (f.base[p] * cos - f.base[p + 2] * sin) * pulse;
                f.positions[p + 1] = f.base[p + 1] * pulse; f.positions[p + 2] = (f.base[p] * sin + f.base[p + 2] * cos) * pulse;
            } else if (motion && record.variant === 'hero') {
                // Source spring behaviour, with substeps so mobile frame rates retain the same feel.
                const substeps = Math.max(1, Math.ceil(step)), h = step / substeps;
                for (let sub = 0; sub < substeps; sub++) {
                    const dx = f.positions[p] - record.mouseX, dy = f.positions[p + 1] - record.mouseY;
                    const distance = Math.sqrt(dx * dx + dy * dy) + .001;
                    if (distance < 6.4 && hover > .05) {
                        const force = (1 - distance / 6.4) * 3.6 * hover;
                        f.velocities[p] += (dx / distance * force * .5 + (Math.random() - .5) * .2) * h;
                        f.velocities[p + 1] += (dy / distance * force * .5 + (Math.random() - .5) * .2) * h;
                        f.velocities[p + 2] += (Math.random() - .5) * force * .95 * h;
                    }
                    for (let axis = 0; axis < 3; axis++) {
                        f.velocities[p + axis] += (f.base[p + axis] - f.positions[p + axis]) * .07 * h;
                        f.velocities[p + axis] *= Math.pow(.84, h); f.positions[p + axis] += f.velocities[p + axis] * h;
                    }
                }
            } else {
                f.positions[p] = f.base[p]; f.positions[p + 1] = f.base[p + 1]; f.positions[p + 2] = f.base[p + 2];
                f.velocities[p] = f.velocities[p + 1] = f.velocities[p + 2] = 0;
            }
            for (let axis = 0; axis < 3; axis++) {
                const color = record.themeColors[p + axis], target = record.light ? color * .65 : 1;
                f.colors[p + axis] = color + (target - color) * hover * (i >= f.penguinCount ? .85 : .6);
            }
        }
        f.geometry.attributes.position.needsUpdate = true; f.geometry.attributes.color.needsUpdate = true;
        record.renderer.render(record.scene, record.camera); record.dirty = false;
    }
    function schedule() { if (!raf && !document.hidden && !disposed) raf = requestAnimationFrame(tick); }
    function tick(now) {
        raf = 0;
        if (document.hidden || disposed) { lastFrame = 0; return; }
        const delta = lastFrame ? Math.min((now - lastFrame) / 1000, .05) : 1 / 60;
        if (lastFrame && delta < 1 / 32) { schedule(); return; }
        lastFrame = now;
        let keepAnimating = false;
        for (const record of records.values()) {
            if (!record.el.isConnected) { destroyRecord(record); continue; }
            if (!record.visible || record.contextLost || !record.width || !record.height) continue;
            const moving = !reducedMotion.matches && record.variant !== 'thumb' && !record.renderer.isSoftwareRenderer;
            if (record.dirty || moving) render(record, delta);
            if (moving) keepAnimating = true;
        }
        if (keepAnimating) schedule(); else lastFrame = 0;
    }
    function destroyRecord(record) {
        visibilityObserver?.unobserve(record.el); record.resizeObserver?.disconnect(); record.listeners.forEach(remove => remove());
        record.figure.geometry.dispose(); record.material.dispose(); record.texture.dispose(); record.renderer.dispose();
        record.renderer.forceContextLoss(); record.canvas.remove(); records.delete(record.el);
        delete record.el.dataset.particlesReady; delete record.el.dataset.particlesRenderer;
    }
    function mount(root = document) {
        if (disposed) return;
        const elements = [...(root.querySelectorAll?.('[data-gunter-particles]') || [])];
        if (root.matches?.('[data-gunter-particles]')) elements.push(root);
        for (const el of elements) {
            if (records.has(el) || pending.has(el) || !el.isConnected) continue;
            pending.add(el);
            loadThree().then(THREE => {
                if (!disposed && el.isConnected && !records.has(el) && !createRecord(el, THREE)) el.dataset.particlesReady = 'unavailable';
            }).catch(() => { el.dataset.particlesReady = 'unavailable'; }).finally(() => pending.delete(el));
        }
    }
    function replaceLegacyDashboardMascot() {
        const image = document.querySelector('.prism-hero__img-wrap > img');
        if (!image) return;
        const avatar = document.createElement('span'); avatar.dataset.gunterParticles = 'hero';
        avatar.setAttribute('role', 'img'); avatar.setAttribute('aria-label', 'Gunter en partículas'); image.replaceWith(avatar);
    }
    function init() {
        replaceLegacyDashboardMascot(); mount();
        const mutations = new MutationObserver(entries => {
            let removed = false;
            for (const entry of entries) {
                if (entry.type === 'attributes') {
                    for (const record of records.values()) if (record.light !== isLight()) applyPalette(record);
                    schedule(); continue;
                }
                removed ||= entry.removedNodes.length > 0;
                for (const node of entry.addedNodes) if (node.nodeType === 1) mount(node);
            }
            if (removed) for (const record of records.values()) if (!record.el.isConnected) destroyRecord(record);
        });
        mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        mutations.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-color-mode'] });
        const onMotion = () => {
            for (const record of records.values()) {
                record.dirty = true; record.active = false; record.hover = 0;
                record.mouseX = record.mouseY = record.targetX = record.targetY = 0;
                record.figure.velocities.fill(0);
            }
            schedule();
        };
        reducedMotion.addEventListener?.('change', onMotion);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { cancelAnimationFrame(raf); raf = 0; lastFrame = 0; } else schedule();
        });
        window.addEventListener('pagehide', event => {
            cancelAnimationFrame(raf); raf = 0; lastFrame = 0;
            if (event.persisted) return;
            disposed = true;
            for (const record of records.values()) destroyRecord(record);
            mutations.disconnect(); visibilityObserver?.disconnect(); reducedMotion.removeEventListener?.('change', onMotion);
        });
        window.addEventListener('pageshow', () => schedule());
    }
    window.GunterParticles = { mount };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
