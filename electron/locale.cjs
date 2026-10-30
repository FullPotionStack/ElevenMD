'use strict';
const pt = Object.freeze({
  'Open': 'Abrir', 'Save As': 'Salvar como', 'Supported documents': 'Documentos compatíveis', 'Markdown and text': 'Markdown e texto',
  'Cannot open document': 'Não foi possível abrir o documento', 'Export RTF': 'Exportar RTF', 'Export PDF': 'Exportar PDF',
  'Rich Text Format': 'Formato de texto rico', 'PDF document': 'Documento PDF', 'Resolve file changes': 'Resolver alterações no arquivo',
  'Recreate {name} on disk?': 'Recriar {name} no disco?', 'Replace the disk version of {name}?': 'Substituir a versão de {name} no disco?',
  'Your reviewed editor or merged version will be written. Cancel leaves the disk file unchanged.': 'Sua versão revisada ou mesclada será gravada. Cancelar mantém o arquivo no disco inalterado.',
  'Write file': 'Gravar arquivo', 'Cancel': 'Cancelar', 'Locate {name}': 'Localizar {name}',
  'Open link': 'Abrir link', 'Open this link outside ElevenMD?': 'Abrir este link fora do ElevenMD?',
  'Insert image': 'Inserir imagem', 'Raster images': 'Imagens raster',
  'Do you want to save changes to {name}?': 'Deseja salvar as alterações em {name}?',
  'Untitled': 'Sem título', 'Save': 'Salvar', "Don't Save": 'Não salvar',
  'Export sanitized diagnostics': 'Exportar diagnóstico sem dados sensíveis', 'JSON diagnostics': 'Diagnóstico JSON',
  'Update ElevenMD': 'Atualizar ElevenMD', 'Install ElevenMD {version}?': 'Instalar ElevenMD {version}?', 'Install and restart': 'Instalar e reiniciar',
  'Your tabs will be checkpointed before ElevenMD closes. The updater will show progress, update this copy in its current folder, and reopen it without a setup wizard. Portable copies stay portable. Your document files will not be overwritten.': 'Suas abas serão salvas antes de fechar o ElevenMD. O atualizador mostrará o progresso, atualizará esta cópia na pasta atual e a reabrirá sem um assistente de instalação. Cópias portáteis continuam portáteis. Seus documentos não serão sobrescritos.',
});
function createNativeLocale() {
  let locale = 'en';
  return {
    set(value) { locale = value === 'pt-BR' ? value : 'en'; },
    t(key, values = {}) {
      const text = locale === 'pt-BR' ? pt[key] || key : key;
      return text.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
    },
  };
}
module.exports = { createNativeLocale };
