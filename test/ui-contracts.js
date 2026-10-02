const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const primaryPages = ['index.html', 'dashboard.html', 'day.html', 'config.html', 'results.html'];

for (const file of primaryPages) {
    const html = read(file);
    assert.match(html, /class="skip-link" href="#main-content"/, `${file} exposes a skip link`);
    assert.match(html, /<main\b[^>]*id="main-content"[^>]*tabindex="-1"/, `${file} has a focusable main landmark`);
}

const themedPages = ['index.html', 'dashboard.html', 'day.html', 'config.html', 'results.html', 'meeting.html', 'new-project.html', 'login.html', 'admin.html'];
for (const file of themedPages) {
    const html = read(file);
    assert.match(html, /href="styles\/gunter-cinematic\.css\?/, `${file} loads the shared Polar palette`);
    assert.match(html, /src="js\/services\/theme-toggle\.js\?/, `${file} exposes the light/dark control`);
    assert.match(html, /src="js\/services\/gunter-icon-system\.js\?/, `${file} loads the shared icon system`);
}
const themeToggle = read('js/services/theme-toggle.js');
assert.match(themeToggle, /const KEY = 'gunter_color_mode'/, 'color mode does not overwrite the meeting profile key');
assert.match(themeToggle, /apply\(current, hasExplicitPreference\(\)\)/, 'first visit follows the device color-scheme preference');
assert.match(read('styles/gunter-cinematic.css'), /--gd-primary: #006F78/, 'light palette uses the Polar teal accent');
assert.match(read('styles/gunter-cinematic.css'), /--gd-primary: #68C8CE/, 'dark palette uses the Polar teal accent');
assert.match(read('styles/gunter-cinematic.css'), /--gd-on-primary: #FFFFFF/, 'light primary controls have a dedicated contrasting foreground');
assert.match(read('styles/gunter-cinematic.css'), /--gd-on-primary: #08262A/, 'dark primary controls have a dedicated contrasting foreground');
assert.match(read('styles/gunter-cinematic.css'), /\.env-card__description[\s\S]*color: #F3FAFB/, 'environment thumbnails use readable foregrounds over dark overlays');
assert.match(read('styles/gunter-cinematic.css'), /\.project-card::before/, 'project miniatures receive a consistent technical visual treatment');
assert.match(read('styles/gunter-command-center.css'), /\.config-tabs \.config-tab\.is-active[\s\S]*color: #FFFFFF !important/, 'active configuration tabs use a readable light-theme foreground');
assert.match(read('styles/gunter-command-center.css'), /\.config-tabs \.config-tab\.is-active[\s\S]*color: #08262A !important/, 'active configuration tabs use a readable dark-theme foreground');
assert.match(read('styles/gunter-command-center.css'), /\.gunter-command-nav \.gunter-command-nav__action span[\s\S]*color: #FFFFFF !important/, 'mobile navigation action text contrasts with its teal button');
const cinematicShell = read('js/services/gunter-cinematic-shell.js');
assert.doesNotMatch(cinematicShell, /AMBIENT_VIDEO|createElement\('video'/, 'the shared background does not fetch or animate an external video');
assert.doesNotMatch(cinematicShell, /createElement\('div', 'gunter-cinematic-wordmark'/, 'the ambient background has no Gunter wordmark');
assert.doesNotMatch(cinematicShell, /createHeadRig\(MASCOT_SOURCE, '', 'gunter-character-rig--ambient'\)/, 'the ambient background has no Gunter character');
assert.match(read('styles/gunter-cinematic.css'), /\.gunter-cinematic-bg::after\s*\{[\s\S]*?background-image: repeating-linear-gradient\(180deg, transparent 0 5px/, 'the active background uses restrained static scanlines instead of the old network grid');
assert.match(read('styles/gunter-command-center.css'), /html body\.gunter-command-center \.gunter-command-nav__brand,[\s\S]*html body\.gunter-command-center \.gunter-command-nav__settings \{ display: none !important; \}/, 'mobile pages have no duplicate top navigation bar');
for (const page of ['index.html', 'new-project.html', 'config.html', 'results.html', 'meeting.html', 'dashboard.html', 'admin.html']) {
    assert.doesNotMatch(read(page), /src="js\/particle-effects\.js/, `${page} does not start a connected-particle background`);
}
assert.match(read('styles/gunter-cinematic.css'), /\.gunter-cinematic-wordmark \{ display: none !important; \}/, 'legacy ambient wordmarks remain hidden');
assert.match(read('styles/gunter-cinematic.css'), /\.gunter-cinematic-stage \{ display: none !important; \}/, 'legacy ambient mascot stages remain hidden');
assert.match(read('styles/gunter-cinematic.css'), /\.prism-hero::before \{ content: none !important; display: none !important; \}/, 'the hero has no oversized Gunter watermark behind its content');

const config = read('config.html');
assert.equal((config.match(/class="gunter-icon" data-gunter-icon=/g) || []).length, 4, 'configuration tabs use the shared outline icon treatment');
for (const id of ['premium', 'preferences', 'data', 'trash']) {
    assert.match(config, new RegExp(`id="config-tab-${id}"[^>]*aria-controls="config-panel-${id}"`));
    assert.match(config, new RegExp(`id="config-panel-${id}"[^>]*role="tabpanel"[^>]*aria-labelledby="config-tab-${id}"`));
}
assert.doesNotMatch(config, /<button[^>]+\bonclick=/i, 'configuration controls are bound without inline handlers');
assert.match(read('js/config-settings.js'), /event\.key === 'ArrowRight'/, 'configuration tabs support arrow-key navigation');
assert.match(read('js/config-settings.js'), /event\.key === 'Home'/, 'configuration tabs support Home/End navigation');
assert.match(read('js/config-settings.js'), /addEventListener\('hashchange'/, 'configuration deep links activate the matching tab');

const commandNav = read('js/services/gunter-command-center.js');
for (const label of ['Inicio', 'Conversaciones', 'Reuniones', 'Resultados', 'Conexiones', 'Nueva reunión']) {
    assert.ok(commandNav.includes(label), `global navigation exposes ${label}`);
}
assert.match(commandNav, /aria-current="page"/, 'current navigation destination is announced');
assert.match(commandNav, /disclosure\.open = false/, 'mobile and task menus close after choosing a destination');
assert.match(commandNav, /gunter-command-nav__dock/, 'the mobile main menu exposes a persistent navigation dock');
assert.match(commandNav, /GunterIconSystem\?\.markup/, 'main navigation requests icons from the shared icon registry');
assert.match(commandNav, /aria-controls="gunter-mobile-menu"/, 'mobile menu toggle is programmatically associated with its disclosure');
assert.match(commandNav, /event\.key !== 'Escape'/, 'mobile menu can be dismissed from the keyboard');
assert.match(commandNav, /document\.body\.prepend\(nav\)/, 'global page navigation is mounted outside legacy page frames');
assert.match(commandNav, /container\.prepend\(flow\)/, 'breadcrumbs remain inside the current page content');
assert.match(read('styles/gunter-command-center.css'), /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/, 'the mobile dock uses five predictable touch targets');
assert.match(read('styles/gunter-command-center.css'), /@media \(min-width: 821px\)[\s\S]*position: fixed[\s\S]*flex-direction: column/, 'desktop navigation becomes a fixed, single vertical rail');
assert.match(read('styles/gunter-command-center.css'), /@media \(max-width: 560px\)[\s\S]*\.gunter-home__mascot-stage/, 'Gunter home hero adapts to phone-width screens');
const iconSystem = read('js/services/gunter-icon-system.js');
assert.match(iconSystem, /Extended_Pictographic/, 'legacy pictogram icons are normalized without rewriting regular copy');
assert.match(iconSystem, /new MutationObserver/, 'dynamically rendered icons use the same visual language');

const day = read('day.html');
assert.match(commandNav, /¿Qué necesitas resolver hoy\?/ , 'the post-login Inicio screen has an assistant-focused hero');
assert.match(commandNav, /America\/Bogota/, 'the home screen clock uses the actual Bogota time zone');
assert.match(commandNav, /\.gunter-home__focus.*focusCommand/s, 'the home CTA focuses the existing working command input');
assert.match(commandNav, /GunterParticles\?\.mount\?\./, 'the home mascot mounts the shared particle renderer');
assert.match(commandNav, /data-gunter-particles="hero"/, 'the home mascot uses the particle hero variant');
assert.match(read('js/services/gunter-particles.js'), /record\.targetX[\s\S]*record\.gazeX/, 'pointer tracking animates Gunter particles around the head');
assert.match(read('styles/gunter-command-center.css'), /body\.gunter-page-day \.gunter-command-nav__brand,[\s\S]*body\.gunter-page-day \.gunter-command-nav__links \{ display: none !important; \}/, 'the duplicated top brand bar is hidden on the mobile home screen');
assert.match(read('js/services/gunter-companion.js'), /data-gunter-particles="chat"/, 'the floating Gunter companion uses the particle mascot');
assert.match(read('js/services/gunter-particles.js'), /replaceLegacyDashboardMascot/, 'the meetings page replaces the remaining raster mascot with the particle renderer');
assert.match(day, /id="gday-quickbar-input"[^>]*aria-label=/, 'quick command input has an accessible name');
assert.match(day, /id="gday-date"/, 'the dynamic local date remains connected to the day controller');
assert.match(day, /id="gday-doc-btn"[^>]*aria-label=/, 'attachment icon button has an accessible name');
assert.match(read('js/controllers/day-tabs.js'), /bar\.onkeydown/, 'day tabs support keyboard navigation');
assert.match(read('js/controllers/day-tabs.js'), /addEventListener\('hashchange'/, 'day deep links activate the matching panel');
assert.match(read('styles/gunter-command-center.css'), /prefers-reduced-motion:\s*reduce/, 'global navigation honors reduced-motion preference');
assert.match(read('styles/ui-polish.css'), /\.skip-link:focus-visible/, 'skip link appears on keyboard focus');
for (const id of ['status-fcm', 'status-apns']) assert.match(config, new RegExp(`id="${id}"`));

const dashboard = read('dashboard.html');
assert.match(dashboard, /id="gunter-features"[^>]*aria-labelledby="gunter-features-title"/, 'Dashboard exposes a linkable, labelled feature overview');
assert.match(dashboard, /CORE FEATURES · GUNTER/, 'feature overview uses Gunter product naming');
for (const id of ['intent', 'control', 'conversation']) {
    assert.match(dashboard, new RegExp(`id="gunter-feature-${id}-title"`), `feature ${id} has a semantic heading`);
}
assert.match(dashboard, /fonts\.googleapis\.com\/css2\?family=Inter:wght@400;500;600/, 'feature section loads Inter at the requested weights');
const featureStyles = read('styles/pages/gunter-features.css');
assert.match(featureStyles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/, 'feature section uses three desktop columns');
assert.match(featureStyles, /@media \(max-width: 900px\)[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, 'feature section adapts to two columns on tablet');
assert.match(featureStyles, /@media \(max-width: 600px\)[\s\S]*grid-template-columns: 1fr/, 'feature section stacks on phones');

console.log('UI contracts: accessibility, shared Polar palette, light/dark preference, and navigation behavior passed.');
