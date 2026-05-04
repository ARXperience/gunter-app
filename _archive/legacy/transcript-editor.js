/* =============================================
   GUNTER APP - Transcript Editor
   Edit transcriptions before analysis
   ============================================= */

class GunterTranscriptEditor {
    constructor() {
        this.modal = null;
        this.editor = null;
        this.originalText = '';
        this.onSave = null;
    }

    /**
     * Open editor with transcript
     * @param {string} transcript - Current transcript
     * @param {Function} onSave - Callback when saved
     */
    open(transcript, onSave) {
        this.originalText = transcript;
        this.onSave = onSave;

        // Create modal if doesn't exist
        if (!this.modal) {
            this.createModal();
        }

        // Set content
        this.editor.value = transcript;
        this.updateStats();

        // Show modal
        this.modal.style.display = 'flex';
        this.editor.focus();
    }

    /**
     * Create modal structure
     */
    createModal() {
        const modalHTML = `
            <div class="transcript-editor-modal" id="transcript-editor-modal">
                <div class="transcript-editor-container">
                    <div class="transcript-editor-header">
                        <h3>✏️ Editar Transcripción</h3>
                        <button class="close-btn" id="editor-close-btn">✕</button>
                    </div>
                    
                    <div class="transcript-editor-toolbar">
                        <div class="editor-stats" id="editor-stats">
                            <span id="word-count">0 palabras</span>
                            <span>•</span>
                            <span id="char-count">0 caracteres</span>
                        </div>
                        <div class="editor-actions">
                            <button class="btn btn--small" id="find-replace-btn">🔍 Buscar</button>
                            <button class="btn btn--small" id="undo-btn">↶ Deshacer</button>
                        </div>
                    </div>
                    
                    <textarea 
                        class="transcript-editor-textarea" 
                        id="transcript-editor-textarea"
                        placeholder="Edita la transcripción aquí..."
                        spellcheck="true"
                    ></textarea>
                    
                    <div class="transcript-editor-footer">
                        <button class="btn btn--secondary" id="editor-cancel-btn">Cancelar</button>
                        <button class="btn btn--primary" id="editor-save-btn">💾 Guardar y Re-analizar</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        this.modal = document.getElementById('transcript-editor-modal');
        this.editor = document.getElementById('transcript-editor-textarea');

        // Add event listeners
        this.attachEventListeners();

        // Add styles
        this.injectStyles();
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // Close button
        document.getElementById('editor-close-btn').addEventListener('click', () => this.close());
        document.getElementById('editor-cancel-btn').addEventListener('click', () => this.close());

        // Save button
        document.getElementById('editor-save-btn').addEventListener('click', () => this.save());

        // Undo button
        document.getElementById('undo-btn').addEventListener('click', () => this.undo());

        // Find/Replace button
        document.getElementById('find-replace-btn').addEventListener('click', () => this.showFindReplace());

        // Update stats on input
        this.editor.addEventListener('input', () => this.updateStats());

        // Close on backdrop click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });

        // Keyboard shortcuts
        this.editor.addEventListener('keydown', (e) => {
            // Ctrl+S to save
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.save();
            }
            // Ctrl+F to find
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                this.showFindReplace();
            }
        });
    }

    /**
     * Update word and character count
     */
    updateStats() {
        const text = this.editor.value;
        const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
        const chars = text.length;

        document.getElementById('word-count').textContent = `${words} palabras`;
        document.getElementById('char-count').textContent = `${chars} caracteres`;
    }

    /**
     * Save edited transcript
     */
    save() {
        const editedText = this.editor.value;

        if (this.onSave) {
            this.onSave(editedText);
        }

        this.close();
    }

    /**
     * Undo changes
     */
    undo() {
        this.editor.value = this.originalText;
        this.updateStats();
    }

    /**
     * Show find/replace dialog
     */
    showFindReplace() {
        const searchTerm = prompt('Buscar:');
        if (!searchTerm) return;

        const replaceTerm = prompt('Reemplazar con:');
        if (replaceTerm === null) return;

        const text = this.editor.value;
        const regex = new RegExp(searchTerm, 'gi');
        const newText = text.replace(regex, replaceTerm);

        this.editor.value = newText;
        this.updateStats();

        const count = (text.match(regex) || []).length;
        alert(`✅ ${count} ocurrencias reemplazadas`);
    }

    /**
     * Close editor
     */
    close() {
        this.modal.style.display = 'none';
    }

    /**
     * Inject CSS styles
     */
    injectStyles() {
        if (document.getElementById('transcript-editor-styles')) return;

        const styles = `
            <style id="transcript-editor-styles">
                .transcript-editor-modal {
                    display: none;
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.8);
                    backdrop-filter: blur(10px);
                    z-index: 10000;
                    align-items: center;
                    justify-content: center;
                    animation: fadeIn 0.3s ease;
                }
                
                .transcript-editor-container {
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    border: 1px solid rgba(138, 43, 226, 0.3);
                    border-radius: 16px;
                    width: 90%;
                    max-width: 900px;
                    max-height: 90vh;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 20px 60px rgba(138, 43, 226, 0.3);
                }
                
                .transcript-editor-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 20px 24px;
                    border-bottom: 1px solid rgba(138, 43, 226, 0.2);
                }
                
                .transcript-editor-header h3 {
                    margin: 0;
                    font-size: 20px;
                    color: #fff;
                }
                
                .close-btn {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 24px;
                    cursor: pointer;
                    transition: color 0.2s;
                }
                
                .close-btn:hover {
                    color: #fff;
                }
                
                .transcript-editor-toolbar {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 24px;
                    background: rgba(0, 0, 0, 0.2);
                    border-bottom: 1px solid rgba(138, 43, 226, 0.1);
                }
                
                .editor-stats {
                    display: flex;
                    gap: 8px;
                    font-size: 13px;
                    color: #888;
                }
                
                .editor-actions {
                    display: flex;
                    gap: 8px;
                }
                
                .btn--small {
                    padding: 6px 12px;
                    font-size: 13px;
                }
                
                .transcript-editor-textarea {
                    flex: 1;
                    padding: 24px;
                    background: rgba(0, 0, 0, 0.3);
                    border: none;
                    color: #fff;
                    font-family: 'Inter', monospace;
                    font-size: 14px;
                    line-height: 1.6;
                    resize: none;
                    outline: none;
                }
                
                .transcript-editor-textarea::placeholder {
                    color: #555;
                }
                
                .transcript-editor-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                    padding: 20px 24px;
                    border-top: 1px solid rgba(138, 43, 226, 0.2);
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
            </style>
        `;

        document.head.insertAdjacentHTML('beforeend', styles);
    }
}

// Export
window.GunterTranscriptEditor = GunterTranscriptEditor;
