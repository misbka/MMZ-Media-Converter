'use strict';

/**
 * src/main/settingsStore.js
 * ------------------------------------------------------------------
 * Persistência simples (JSON) das preferências do usuário:
 * idioma, tema, formato padrão por categoria, pasta de destino,
 * modo de nomenclatura, qualidade e concorrência.
 *
 * O arquivo fica em `app.getPath('userData')/settings.json`.
 * ------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const DEFAULTS = Object.freeze({
  /** Idioma da interface / UI language: 'pt-BR' | 'es' | 'en' */
  language: 'pt-BR',
  /** Tema visual / visual theme: 'dark' | 'light' */
  theme: 'dark',
  /** Qualidade global de saída / global output quality */
  quality: 'medium',
  /** '' significa "usar a pasta do arquivo de origem" */
  outputDir: '',
  /** 'keep' mantém o nome original, 'suffix' adiciona sufixo */
  namingMode: 'keep',
  /** Sufixo aplicado quando namingMode === 'suffix' */
  suffix: '_converted',
  /** Formato padrão para cada categoria de arquivo */
  defaultFormats: { video: 'mp4', audio: 'mp3', image: 'jpg', document: 'pdf' },
  /** Quantas conversões rodam em paralelo / parallel jobs */
  concurrency: Math.max(1, Math.min(4, require('os').cpus().length - 1 || 2)),
  /** Última janela salva (posição/tamanho) */
  windowBounds: null,
});

class SettingsStore extends EventEmitter {
  /**
   * @param {string} filePath caminho do arquivo JSON de settings
   */
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.data = this._load();
  }

  /** Lê o arquivo do disco, fazendo merge com os padrões. */
  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return this._merge(parsed);
    } catch (err) {
      // Primeira execução ou arquivo corrompido: usa os padrões.
      return this._merge({});
    }
  }

  /**
   * Merge profundo raso (suficiente para o formato atual).
   * @param {object} incoming
   */
  _merge(incoming) {
    const merged = { ...DEFAULTS, ...(incoming || {}) };
    merged.defaultFormats = { ...DEFAULTS.defaultFormats, ...((incoming && incoming.defaultFormats) || {}) };
    return merged;
  }

  /** @returns {object} cópia das configurações atuais */
  get() {
    return JSON.parse(JSON.stringify(this.data));
  }

  /**
   * Atualiza parcialmente as configurações e persiste.
   * @param {object} patch
   * @returns {object} configurações atualizadas
   */
  set(patch) {
    this.data = this._merge({ ...this.data, ...(patch || {}) });
    this._save();
    this.emit('changed', this.get());
    return this.get();
  }

  /** Grava no disco de forma síncrona (arquivo pequeno). */
  _save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      // Falha de persistência não deve quebrar o app.
      // eslint-disable-next-line no-console
      console.error('[settings] falha ao salvar:', err.message);
    }
  }
}

module.exports = { SettingsStore, DEFAULTS };
