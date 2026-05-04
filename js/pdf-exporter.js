/* =============================================
   GUNTER APP - PDF Exporter
   Professional PDF reports with charts and branding
   ============================================= */

class GunterPDFExporter {
    constructor() {
        this.pageWidth = 210; // A4 width in mm
        this.pageHeight = 297; // A4 height in mm
        this.margin = 20;
        this.contentWidth = this.pageWidth - (this.margin * 2);
    }

    /**
     * Export analysis to PDF
     * @param {Object} projectData - Project information
     * @param {Object} analysisData - Analysis results
     * @param {string} transcription - Meeting transcription
     */
    async exportToPDF(projectData, analysisData, transcription) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        let yPosition = this.margin;
        let currentPage = 1;

        // Cover Page
        yPosition = this.addCoverPage(doc, projectData);

        // Table of Contents
        doc.addPage();
        currentPage++;
        yPosition = this.addTableOfContents(doc);

        // Executive Summary
        doc.addPage();
        currentPage++;
        yPosition = await this.addExecutiveSummary(doc, analysisData, yPosition);

        // Viability Section
        if (this.needsNewPage(yPosition, 60)) {
            doc.addPage();
            currentPage++;
            yPosition = this.margin;
        }
        yPosition = this.addViabilitySection(doc, analysisData, yPosition);

        // Diagnosis Section
        if (this.needsNewPage(yPosition, 80)) {
            doc.addPage();
            currentPage++;
            yPosition = this.margin;
        }
        yPosition = this.addDiagnosisSection(doc, analysisData, yPosition);

        // Risks Section
        if (this.needsNewPage(yPosition, 60)) {
            doc.addPage();
            currentPage++;
            yPosition = this.margin;
        }
        yPosition = this.addRisksSection(doc, analysisData, yPosition);

        // Decisions Section
        if (this.needsNewPage(yPosition, 60)) {
            doc.addPage();
            currentPage++;
            yPosition = this.margin;
        }
        yPosition = this.addDecisionsSection(doc, analysisData, yPosition);

        // Roadmap Section
        if (this.needsNewPage(yPosition, 80)) {
            doc.addPage();
            currentPage++;
            yPosition = this.margin;
        }
        yPosition = this.addRoadmapSection(doc, analysisData, yPosition);

        // SWOT Analysis with Chart
        doc.addPage();
        currentPage++;
        yPosition = await this.addSWOTSection(doc, analysisData, this.margin);

        // Gunter Recommendations
        if (this.needsNewPage(yPosition, 60)) {
            doc.addPage();
            currentPage++;
            yPosition = this.margin;
        }
        yPosition = this.addGunterRecommendations(doc, analysisData, yPosition);

        // Add page numbers to all pages
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            this.addFooter(doc, i, totalPages);
        }

        // Save PDF
        const filename = `Gunter_${projectData.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(filename);

        return filename;
    }

    /**
     * Add cover page
     */
    addCoverPage(doc, projectData) {
        // Gunter Logo/Title
        doc.setFontSize(36);
        doc.setTextColor(138, 43, 226); // Purple
        doc.text('GUNTER', this.pageWidth / 2, 60, { align: 'center' });

        doc.setFontSize(14);
        doc.setTextColor(100, 100, 100);
        doc.text('AI Strategic Project Analysis', this.pageWidth / 2, 70, { align: 'center' });

        // Project Name
        doc.setFontSize(24);
        doc.setTextColor(0, 0, 0);
        doc.text(projectData.name || 'Proyecto Sin Nombre', this.pageWidth / 2, 120, { align: 'center' });

        // Environment Badge
        doc.setFontSize(12);
        doc.setTextColor(138, 43, 226);
        const envText = this.getEnvironmentLabel(projectData.environment);
        doc.text(envText, this.pageWidth / 2, 135, { align: 'center' });

        // Date
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        const dateText = `Generado: ${new Date().toLocaleDateString('es-MX', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        })}`;
        doc.text(dateText, this.pageWidth / 2, 260, { align: 'center' });

        return 280;
    }

    /**
     * Add table of contents
     */
    addTableOfContents(doc) {
        doc.setFontSize(20);
        doc.setTextColor(0, 0, 0);
        doc.text('Índice', this.margin, this.margin + 10);

        const contents = [
            '1. Resumen Ejecutivo',
            '2. Viabilidad del Proyecto',
            '3. Diagnóstico Estratégico',
            '4. Análisis de Riesgos',
            '5. Decisiones Críticas',
            '6. Roadmap del Proyecto',
            '7. Análisis SWOT',
            '8. Recomendaciones de Gunter'
        ];

        doc.setFontSize(11);
        doc.setTextColor(60, 60, 60);
        let y = this.margin + 30;

        contents.forEach(item => {
            doc.text(item, this.margin + 5, y);
            y += 10;
        });

        return y;
    }

    /**
     * Add executive summary
     */
    async addExecutiveSummary(doc, analysisData, yPos) {
        doc.setFontSize(18);
        doc.setTextColor(0, 0, 0);
        doc.text('1. Resumen Ejecutivo', this.margin, yPos);
        yPos += 15;

        const summary = analysisData.gunter_summary || analysisData.gunter_pmbok_summary || {};
        const assessment = summary.overall_assessment || summary.project_health || 'No disponible';

        doc.setFontSize(10);
        doc.setTextColor(60, 60, 60);
        const lines = doc.splitTextToSize(assessment, this.contentWidth);
        doc.text(lines, this.margin, yPos);
        yPos += lines.length * 5 + 10;

        return yPos;
    }

    /**
     * Add viability section
     */
    addViabilitySection(doc, analysisData, yPos) {
        doc.setFontSize(18);
        doc.setTextColor(0, 0, 0);
        doc.text('2. Viabilidad del Proyecto', this.margin, yPos);
        yPos += 15;

        const viability = analysisData.viability || {};

        // Status badge
        const status = viability.status || 'yellow';
        const statusColor = this.getStatusColor(status);
        doc.setFillColor(statusColor.r, statusColor.g, statusColor.b);
        doc.roundedRect(this.margin, yPos - 5, 40, 8, 2, 2, 'F');

        doc.setFontSize(10);
        doc.setTextColor(255, 255, 255);
        doc.text(viability.label || 'EN REVISIÓN', this.margin + 20, yPos, { align: 'center' });
        yPos += 15;

        // Assessment
        doc.setTextColor(60, 60, 60);
        const assessment = viability.pmbok_assessment || viability.justification || 'No disponible';
        const lines = doc.splitTextToSize(assessment, this.contentWidth);
        doc.text(lines, this.margin, yPos);
        yPos += lines.length * 5 + 10;

        return yPos;
    }

    /**
     * Add diagnosis section
     */
    addDiagnosisSection(doc, analysisData, yPos) {
        doc.setFontSize(18);
        doc.setTextColor(0, 0, 0);
        doc.text('3. Diagnóstico Estratégico', this.margin, yPos);
        yPos += 15;

        const diagnosis = analysisData.diagnosis || {};

        // Budget
        if (diagnosis.budget) {
            doc.setFontSize(12);
            doc.setTextColor(138, 43, 226);
            doc.text('Presupuesto:', this.margin, yPos);
            yPos += 7;

            doc.setFontSize(10);
            doc.setTextColor(60, 60, 60);
            const budgetLines = doc.splitTextToSize(diagnosis.budget, this.contentWidth - 10);
            doc.text(budgetLines, this.margin + 5, yPos);
            yPos += budgetLines.length * 5 + 8;
        }

        // Goal
        if (diagnosis.goal) {
            doc.setFontSize(12);
            doc.setTextColor(138, 43, 226);
            doc.text('Objetivo:', this.margin, yPos);
            yPos += 7;

            doc.setFontSize(10);
            doc.setTextColor(60, 60, 60);
            const goalLines = doc.splitTextToSize(diagnosis.goal, this.contentWidth - 10);
            doc.text(goalLines, this.margin + 5, yPos);
            yPos += goalLines.length * 5 + 8;
        }

        return yPos;
    }

    /**
     * Add risks section
     */
    addRisksSection(doc, analysisData, yPos) {
        doc.setFontSize(18);
        doc.setTextColor(0, 0, 0);
        doc.text('4. Análisis de Riesgos', this.margin, yPos);
        yPos += 15;

        const risks = analysisData.risks || analysisData.risk_register || [];

        risks.slice(0, 5).forEach((risk, index) => {
            if (this.needsNewPage(yPos, 30)) {
                doc.addPage();
                yPos = this.margin;
            }

            // Risk title
            doc.setFontSize(11);
            doc.setTextColor(200, 50, 50);
            doc.text(`• ${risk.title || risk.description}`, this.margin + 2, yPos);
            yPos += 7;

            // Mitigation
            doc.setFontSize(9);
            doc.setTextColor(60, 60, 60);
            const mitigationText = `Mitigación: ${risk.mitigation || risk.response_strategy || 'No especificada'}`;
            const mitigationLines = doc.splitTextToSize(mitigationText, this.contentWidth - 10);
            doc.text(mitigationLines, this.margin + 5, yPos);
            yPos += mitigationLines.length * 4 + 6;
        });

        return yPos;
    }

    /**
     * Add decisions section
     */
    addDecisionsSection(doc, analysisData, yPos) {
        doc.setFontSize(18);
        doc.setTextColor(0, 0, 0);
        doc.text('5. Decisiones Críticas', this.margin, yPos);
        yPos += 15;

        const decisions = analysisData.decisions || {};

        // Immediate decisions
        if (decisions.immediate && decisions.immediate.length > 0) {
            doc.setFontSize(12);
            doc.setTextColor(138, 43, 226);
            doc.text('Acciones Inmediatas:', this.margin, yPos);
            yPos += 7;

            doc.setFontSize(10);
            doc.setTextColor(60, 60, 60);
            decisions.immediate.slice(0, 5).forEach(decision => {
                const text = typeof decision === 'string' ? decision : decision.decision;
                doc.text(`• ${text}`, this.margin + 5, yPos);
                yPos += 6;
            });
            yPos += 5;
        }

        return yPos;
    }

    /**
     * Add roadmap section
     */
    addRoadmapSection(doc, analysisData, yPos) {
        doc.setFontSize(18);
        doc.setTextColor(0, 0, 0);
        doc.text('6. Roadmap del Proyecto', this.margin, yPos);
        yPos += 15;

        const roadmap = analysisData.roadmap || [];

        roadmap.slice(0, 4).forEach((phase, index) => {
            if (this.needsNewPage(yPos, 25)) {
                doc.addPage();
                yPos = this.margin;
            }

            doc.setFontSize(11);
            doc.setTextColor(138, 43, 226);
            doc.text(`Fase ${index + 1}: ${phase.phase}`, this.margin, yPos);
            yPos += 7;

            doc.setFontSize(9);
            doc.setTextColor(60, 60, 60);
            doc.text(`Duración: ${phase.duration}`, this.margin + 5, yPos);
            yPos += 10;
        });

        return yPos;
    }

    /**
     * Add SWOT section with chart
     */
    async addSWOTSection(doc, analysisData, yPos) {
        doc.setFontSize(18);
        doc.setTextColor(0, 0, 0);
        doc.text('7. Análisis SWOT', this.margin, yPos);
        yPos += 15;

        const swot = analysisData.swot_analysis || {};

        // Try to capture chart if it exists
        const chartCanvas = document.getElementById('swot-chart');
        if (chartCanvas) {
            try {
                const chartImage = chartCanvas.toDataURL('image/png');
                doc.addImage(chartImage, 'PNG', this.margin, yPos, 170, 100);
                yPos += 110;
            } catch (error) {
                console.warn('Could not add chart to PDF:', error);
            }
        }

        return yPos;
    }

    /**
     * Add Gunter recommendations
     */
    addGunterRecommendations(doc, analysisData, yPos) {
        doc.setFontSize(18);
        doc.setTextColor(0, 0, 0);
        doc.text('8. Recomendaciones de Gunter', this.margin, yPos);
        yPos += 15;

        const summary = analysisData.gunter_summary || analysisData.gunter_pmbok_summary || {};
        const recommendation = summary.recommendation || summary.strategic_recommendation || 'No disponible';

        doc.setFontSize(10);
        doc.setTextColor(60, 60, 60);
        const lines = doc.splitTextToSize(recommendation, this.contentWidth);
        doc.text(lines, this.margin, yPos);
        yPos += lines.length * 5;

        return yPos;
    }

    /**
     * Add footer with page numbers
     */
    addFooter(doc, pageNum, totalPages) {
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(
            `Página ${pageNum} de ${totalPages} | Generado por Gunter AI`,
            this.pageWidth / 2,
            this.pageHeight - 10,
            { align: 'center' }
        );
    }

    /**
     * Helper: Check if new page is needed
     */
    needsNewPage(currentY, requiredSpace) {
        return currentY + requiredSpace > this.pageHeight - this.margin;
    }

    /**
     * Helper: Get status color
     */
    getStatusColor(status) {
        const colors = {
            green: { r: 34, g: 197, b: 94 },
            yellow: { r: 234, g: 179, b: 8 },
            red: { r: 239, g: 68, b: 68 }
        };
        return colors[status] || colors.yellow;
    }

    /**
     * Helper: Get environment label
     */
    getEnvironmentLabel(env) {
        const labels = {
            empresarial: 'PROYECTO EMPRESARIAL',
            artistico: 'PROYECTO ARTÍSTICO',
            podcast: 'PROYECTO PODCAST'
        };
        return labels[env] || 'PROYECTO';
    }
}

// Export
window.GunterPDFExporter = GunterPDFExporter;
