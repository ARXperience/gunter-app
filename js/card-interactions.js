/* =============================================
   GUNTER APP - Card Interactions
   JavaScript for flip, expand, drag functionality
   ============================================= */

class GunterCardInteractions {
    constructor() {
        this.init();
    }

    /**
     * Initialize all card interactions
     */
    init() {
        this.initFlipCards();
        this.initExpandableCards();
        this.initDraggableCards();
    }

    /**
     * Initialize flip cards
     */
    initFlipCards() {
        const flipCards = document.querySelectorAll('.card-flip');

        flipCards.forEach(card => {
            card.addEventListener('click', () => {
                card.classList.toggle('flipped');
            });
        });
    }

    /**
     * Initialize expandable cards
     */
    initExpandableCards() {
        const expandableCards = document.querySelectorAll('.card-expandable');

        expandableCards.forEach(card => {
            const header = card.querySelector('.card-expandable-header');
            const content = card.querySelector('.card-expandable-content');

            if (header && content) {
                header.addEventListener('click', () => {
                    const isExpanded = card.classList.contains('expanded');

                    if (isExpanded) {
                        card.classList.remove('expanded');
                    } else {
                        card.classList.add('expanded');
                    }
                });
            }
        });
    }

    /**
     * Initialize draggable cards
     */
    initDraggableCards() {
        const draggableCards = document.querySelectorAll('.card-draggable');

        draggableCards.forEach(card => {
            let isDragging = false;
            let startX, startY, initialX, initialY;

            card.addEventListener('mousedown', (e) => {
                isDragging = true;
                card.classList.add('dragging');

                startX = e.clientX;
                startY = e.clientY;

                const rect = card.getBoundingClientRect();
                initialX = rect.left;
                initialY = rect.top;

                card.style.position = 'fixed';
                card.style.zIndex = '1000';
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;

                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;

                card.style.left = (initialX + deltaX) + 'px';
                card.style.top = (initialY + deltaY) + 'px';
            });

            document.addEventListener('mouseup', () => {
                if (!isDragging) return;

                isDragging = false;
                card.classList.remove('dragging');

                // Optional: Snap back to original position
                // card.style.position = '';
                // card.style.left = '';
                // card.style.top = '';
                // card.style.zIndex = '';
            });
        });
    }

    /**
     * Create a flip card programmatically
     */
    createFlipCard(frontContent, backContent) {
        const card = document.createElement('div');
        card.className = 'card-flip';

        card.innerHTML = `
            <div class="card-flip-inner">
                <div class="card-flip-front">
                    ${frontContent}
                </div>
                <div class="card-flip-back">
                    ${backContent}
                </div>
            </div>
        `;

        return card;
    }

    /**
     * Create an expandable card programmatically
     */
    createExpandableCard(title, content) {
        const card = document.createElement('div');
        card.className = 'card-expandable';

        card.innerHTML = `
            <div class="card-expandable-header">
                <h3>${title}</h3>
                <svg class="card-expandable-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </div>
            <div class="card-expandable-content">
                ${content}
            </div>
        `;

        return card;
    }

    /**
     * Create a stat card programmatically
     */
    createStatCard(value, label, trend, icon) {
        const card = document.createElement('div');
        card.className = 'card-stat card-elevated';

        const trendClass = trend >= 0 ? 'positive' : 'negative';
        const trendIcon = trend >= 0 ? '↑' : '↓';

        card.innerHTML = `
            <div class="card-stat-icon">
                ${icon}
            </div>
            <div class="card-stat-value">${value}</div>
            <div class="card-stat-label">${label}</div>
            <div class="card-stat-trend ${trendClass}">
                ${trendIcon} ${Math.abs(trend)}%
            </div>
        `;

        return card;
    }
}

// Export
window.GunterCardInteractions = GunterCardInteractions;

// Auto-initialize
document.addEventListener('DOMContentLoaded', () => {
    window.gunterCards = new GunterCardInteractions();
});
