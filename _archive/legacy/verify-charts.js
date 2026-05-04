/**
 * Verification Script for Gunter App Dynamic Charts
 * Run these commands in the browser console on results.html to test different states.
 */

const testAnalysis = {
    empresarial: {
        viability: { status: "green", label: "VIABLE", pmbok_assessment: "ROI positivo proyectado en 6 meses." },
        swot_analysis: {
            scores: { strengths: 90, weaknesses: 30, opportunities: 80, threats: 20 },
            details: {
                strengths: "Equipo técnico sólido",
                weaknesses: "Presupuesto ajustado",
                opportunities: "Mercado en expansión",
                threats: "Competencia agresiva"
            }
        },
        gunter_pmbok_summary: {
            project_health: "Saludable",
            recommendation: "Proceder con la fase de diseño.",
            next_steps: ["Definir backlog"]
        }
    },
    artistico: {
        viability: { status: "yellow", label: "INSPIRADOR", pmbok_assessment: "Impacto visual alto, requiere refinamiento técnico." },
        aesthetic_balance: {
            experimental: 85,
            technical: 40,
            emotional: 95,
            commercial: 30
        },
        gunter_summary: {
            overall_assessment: "Visión artística disruptiva.",
            recommendation: "Equilibrar lo técnico con lo emocional.",
            next_steps: ["Moodboard final"]
        }
    },
    podcast: {
        viability: { status: "green", label: "ENGANCHADOR", pmbok_assessment: "Flujo narrativo dinámico con buen gancho." },
        audience_retention_forecast: [85, 95, 80, 75, 90, 85, 95],
        gunter_summary: {
            overall_assessment: "Ritmo excelente.",
            recommendation: "Mantener el hook los primeros 30 segundos.",
            next_steps: ["Grabación de intro"]
        }
    }
};

function testState(env) {
    localStorage.setItem('gunter_env', env);
    localStorage.setItem('gunter_analysis', JSON.stringify(testAnalysis[env]));
    window.location.reload();
}

console.log("Comandos disponibles:");
console.log("testState('empresarial')");
console.log("testState('artistico')");
console.log("testState('podcast')");
