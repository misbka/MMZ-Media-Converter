/**
 * settings.js
 * Persistência simples das configurações do app em JSON (no diretório userData).
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/** Configurações padrão usadas quando não há arquivo salvo ou faltam chaves. */
const DEFAULTS = {
  theme: 'dark',                 // 'light' | 'dark'
  language: 'pt-BR',             // 'pt-BR' | 'en' | 'es'
  outputDir: '',                 // vazio => usar ~/MMZ_Convertidos
  fileNameMode: 'keep',          // 'keep' | 'suffix' | 'prefix'
  fileNameSuffix: '_convertido', // usado no modo 'suffix'
  fileNamePrefix: '',            // usado no modo 'prefix'
  quality: 'balanced',           // 'high' | 'balanced' | 'small'
  keepMetadata: false,
  overwriteExisting: false,
  maxConcurrent: 2,              // conversões simultâneas
  ffmpegPath: ''                 // vazio => autodetectar (./ffmpeg/bin ou PATH)
};

class SettingsStore {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.data = { ...DEFAULTS, ...this._read() };
  }

  /** Lê o arquivo de settings, tolerando arquivo corrompido. */
  _read() {
    try {
      if (fs.existsSync(this.file)) {
        return JSON.parse(fs.readFileSync(this.file, 'utf8'));
      }
    } catch (err) {
      console.warn('[settings] Falha ao ler settings:', err.message);
    }
    return {};
  }

  /** Retorna todas as configurações mescladas com os padrões. */
  getAll() {
    return { ...DEFAULTS, ...this.data };
  }

  /** Aplica um patch parcial e persiste no disco. */
  set(partial = {}) {
    this.data = { ...this.data, ...partial };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.warn('[settings] Falha ao gravar settings:', err.message);
    }
    return this.getAll();
  }

  /** Diretório de saída efetivo (pasta padrão do usuário se não configurado). */
  resolveOutputDir() {
    const configured = this.data.outputDir;
    if (configured && configured.trim()) return configured;
    return path.join(app.getPath('home'), 'MMZ_Convertidos');
  }
}

module.exports = { SettingsStore, DEFAULTS };
