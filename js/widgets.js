/* =============================================
   GUNTER APP - Dashboard Widgets JavaScript
   Progress rings, mini charts, stat cards
   ============================================= */

class GunterWidgets {
    constructor() {
        this.charts = new Map();
    }

    /**
     * Create a progress ring
     */
    createProgressRing(percentage, label, size = 120) {
        const radius = (size - 16) / 2;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (percentage / 100) * circumference;

        const widget = document.createElement('div');
        widget.className = 'widget widget-progress-ring';

        widget.innerHTML = `
            <div class="progress-ring-container" style="width: ${size}px; height: ${size}px;">
                <svg class="progress-ring-svg" width="${size}" height="${size}">
                    <circle
                        class="progress-ring-circle-bg"
                        cx="${size / 2}"
                        cy="${size / 2}"
                        r="${radius}"
                    />
                    <circle
                        class="progress-ring-circle"
                        cx="${size / 2}"
                        cy="${size / 2}"
                        r="${radius}"
                        stroke-dasharray="${circumference}"
                        stroke-dashoffset="${offset}"
                    />
                </svg>
                <div class="progress-ring-text">${percentage}%</div>
            </div>
            <div class="progress-ring-label">${label}</div>
        `;

        return widget;
    }

    /**
     * Update progress ring
     */
    updateProgressRing(element, percentage) {
        const circle = element.querySelector('.progress-ring-circle');
        const text = element.querySelector('.progress-ring-text');

        if (circle && text) {
            const radius = parseFloat(circle.getAttribute('r'));
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (percentage / 100) * circumference;

            circle.style.strokeDashoffset = offset;
            text.textContent = `${percentage}%`;
        }
    }

    /**
     * Create a stat card
     */
    createStatCard(value, label, trend, icon) {
        const widget = document.createElement('div');
        widget.className = 'widget widget-stat';

        const trendClass = trend >= 0 ? 'positive' : 'negative';
        const trendIcon = trend >= 0 ? '↑' : '↓';

        widget.innerHTML = `
            <div class="widget-stat-icon">
                ${icon}
            </div>
            <div class="widget-stat-value">${value}</div>
            <div class="widget-stat-label">${label}</div>
            <div class="widget-stat-trend ${trendClass}">
                <span class="widget-stat-trend-icon">${trendIcon}</span>
                <span>${Math.abs(trend)}%</span>
            </div>
        `;

        return widget;
    }

    /**
     * Create a mini chart (sparkline)
     */
    createMiniChart(title, value, data) {
        const widget = document.createElement('div');
        widget.className = 'widget widget-mini-chart';

        const canvasId = `mini-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        widget.innerHTML = `
            <div class="mini-chart-header">
                <div class="mini-chart-title">${title}</div>
                <div class="mini-chart-value">${value}</div>
            </div>
            <canvas id="${canvasId}" class="mini-chart-canvas"></canvas>
        `;

        // Draw chart after element is added to DOM
        setTimeout(() => {
            this.drawSparkline(canvasId, data);
        }, 0);

        return widget;
    }

    /**
     * Draw sparkline on canvas
     */
    drawSparkline(canvasId, data) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.offsetWidth;
        const height = canvas.offsetHeight;

        canvas.width = width;
        canvas.height = height;

        const max = Math.max(...data);
        const min = Math.min(...data);
        const range = max - min || 1;

        const xStep = width / (data.length - 1);

        // Draw line
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0, 212, 255, 1)';
        ctx.lineWidth = 2;

        data.forEach((value, index) => {
            const x = index * xStep;
            const y = height - ((value - min) / range) * height;

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

        // Draw fill
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, 'rgba(0, 212, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 212, 255, 0)');

        ctx.fillStyle = gradient;
        ctx.fill();
    }

    /**
     * Create activity feed item
     */
    createActivityItem(title, description, time, icon) {
        const item = document.createElement('div');
        item.className = 'activity-item';

        item.innerHTML = `
            <div class="activity-icon">
                ${icon}
            </div>
            <div class="activity-content">
                <div class="activity-title">${title}</div>
                <div class="activity-description">${description}</div>
                <div class="activity-time">${time}</div>
            </div>
        `;

        return item;
    }

    /**
     * Create activity feed widget
     */
    createActivityFeed(items) {
        const widget = document.createElement('div');
        widget.className = 'widget widget-activity';

        items.forEach(item => {
            widget.appendChild(this.createActivityItem(
                item.title,
                item.description,
                item.time,
                item.icon
            ));
        });

        return widget;
    }

    /**
     * Create quick action button
     */
    createQuickAction(label, icon, onClick) {
        const button = document.createElement('button');
        button.className = 'quick-action-btn';

        button.innerHTML = `
            <div class="quick-action-icon">
                ${icon}
            </div>
            <div class="quick-action-label">${label}</div>
        `;

        button.addEventListener('click', onClick);

        return button;
    }

    /**
     * Animate stat value
     */
    animateStatValue(element, targetValue, duration = 1000) {
        const startValue = 0;
        const startTime = Date.now();

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            const currentValue = Math.floor(startValue + (targetValue - startValue) * progress);
            element.textContent = currentValue;

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };

        animate();
    }
}

// Export
window.GunterWidgets = GunterWidgets;

// Auto-initialize
document.addEventListener('DOMContentLoaded', () => {
    window.gunterWidgets = new GunterWidgets();
});
