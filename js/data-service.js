/* =============================================
   GUNTER APP - Data Service
   Manages projects, analyses, and statistics
   ============================================= */

class GunterDataService {
    constructor() {
        this.storageKey = 'gunter_data';
        this.data = this.load();
    }

    // Load data from localStorage
    load() {
        const stored = localStorage.getItem(this.storageKey);
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error('Error loading data:', e);
            }
        }
        return this.getDefaultData();
    }

    // Save data to localStorage
    save() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.data));
    }

    // Default data structure
    getDefaultData() {
        return {
            projects: [],
            totalMeetingSeconds: 0,
            createdAt: new Date().toISOString()
        };
    }

    // Get statistics
    getStats() {
        const projects = this.data.projects || [];
        const completed = projects.filter(p => p.status === 'completed').length;
        const inProgress = projects.filter(p => p.status === 'in_progress').length;
        const totalHours = Math.round(this.data.totalMeetingSeconds / 3600);

        return {
            totalProjects: projects.length,
            completed: completed,
            inProgress: inProgress,
            meetingHours: totalHours
        };
    }

    // Create or update project
    saveProject(projectData) {
        const existing = this.data.projects.find(p => p.id === projectData.id);

        if (existing) {
            // Update existing project
            Object.assign(existing, projectData, { updatedAt: new Date().toISOString() });
        } else {
            // Create new project
            const newProject = {
                id: projectData.id || 'proj_' + Date.now(),
                name: projectData.name || 'Nuevo Proyecto',
                environment: projectData.environment || 'empresarial',
                market: projectData.market || '',
                budget: projectData.budget || '',
                timeline: projectData.timeline || '',
                status: 'in_progress',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                analyses: []
            };
            this.data.projects.push(newProject);
            this.save();
            return newProject;
        }

        this.save();
        return existing;
    }

    // Add analysis to project
    addAnalysis(projectId, analysis, transcription, durationSeconds) {
        let project = this.data.projects.find(p => p.id === projectId);

        if (!project) {
            // Create project if doesn't exist
            project = this.saveProject({ id: projectId, name: localStorage.getItem('gunter_project') || 'Proyecto' });
        }

        const analysisRecord = {
            id: 'analysis_' + Date.now(),
            timestamp: new Date().toISOString(),
            duration: durationSeconds || 0,
            transcription: transcription || '',
            analysis: analysis,
            viabilityStatus: analysis?.viability?.status || 'yellow'
        };

        project.analyses = project.analyses || [];
        project.analyses.push(analysisRecord);

        // Update meeting time
        this.data.totalMeetingSeconds += (durationSeconds || 0);

        this.save();
        return analysisRecord;
    }

    // Get current project
    getCurrentProject() {
        const projectId = localStorage.getItem('gunter_project_id');
        if (projectId) {
            return this.data.projects.find(p => p.id === projectId);
        }
        return null;
    }

    // Get all projects
    getAllProjects() {
        return this.data.projects || [];
    }

    // Get recent projects (for dashboard)
    getRecentProjects(limit = 6) {
        const projects = [...(this.data.projects || [])];
        return projects
            .filter(p => !p.deletedAt)
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
            .slice(0, limit);
    }

    // Mark project as completed
    completeProject(projectId) {
        const project = this.data.projects.find(p => p.id === projectId);
        if (project) {
            project.status = 'completed';
            project.completedAt = new Date().toISOString();
            this.save();
        }
    }

    // Soft-delete (move to trash). Hard-delete stays available as purgeProject.
    deleteProject(projectId) {
        const p = this.data.projects.find(p => p.id === projectId);
        if (!p) return;
        p.deletedAt = new Date().toISOString();
        this.save();
    }

    // Restore a soft-deleted project.
    restoreProject(projectId) {
        const p = this.data.projects.find(p => p.id === projectId);
        if (!p) return;
        delete p.deletedAt;
        this.save();
    }

    // Permanent delete from trash.
    purgeProject(projectId) {
        this.data.projects = this.data.projects.filter(p => p.id !== projectId);
        this.save();
    }

    // Empty trash (permanent delete of all soft-deleted projects).
    emptyTrash() {
        const before = this.data.projects.length;
        this.data.projects = this.data.projects.filter(p => !p.deletedAt);
        this.save();
        return before - this.data.projects.length;
    }

    // Only active (not trashed) projects.
    getActiveProjects() {
        return (this.data.projects || []).filter(p => !p.deletedAt);
    }

    // Only trashed projects.
    getTrashedProjects() {
        return (this.data.projects || [])
            .filter(p => p.deletedAt)
            .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    }

    // Get all analyses across all projects
    getAllAnalyses() {
        const analyses = [];
        for (const project of this.data.projects || []) {
            for (const analysis of project.analyses || []) {
                analyses.push({
                    ...analysis,
                    projectId: project.id,
                    projectName: project.name,
                    projectEnv: project.environment
                });
            }
        }
        return analyses.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    // Get analysis by ID
    getAnalysis(analysisId) {
        for (const project of this.data.projects || []) {
            const analysis = (project.analyses || []).find(a => a.id === analysisId);
            if (analysis) {
                return { ...analysis, project };
            }
        }
        return null;
    }

    // Clear all data
    clearAll() {
        this.data = this.getDefaultData();
        this.save();
    }
}

// Create global instance
window.gunterData = new GunterDataService();
