# Histórico de versões

Todas as alterações relevantes deste projeto serão documentadas neste arquivo.

## 1.3.6 - 2026-07-21

### Corrigido

- restauradas as entradas JavaScript e folhas de estilo das versões `1.3.3` e `1.3.4`, evitando erro 404 quando o Foundry ainda mantém um manifesto anterior em memória;
- as entradas antigas agora funcionam como aliases permanentes para a implementação atual e não serão removidas em atualizações futuras;
- o manifesto atual usa novas entradas sem quebrar clientes que ainda solicitam `main-v2.js`, `main-v3.js` ou seus estilos correspondentes.

## 1.3.5 - 2026-07-21

### Corrigido

- restaurado o identificador `data-resource-kind="city"` no formulário da ficha;
- adicionada uma regra explícita para manter o painel do mapa visível mesmo quando uma folha de estilos antiga ainda estiver carregada no Foundry;
- renovados os URLs do editor e dos estilos para invalidar o cache da versão anterior.

## 1.3.4 - 2026-07-21

### Corrigido

- o mapa da Cidade agora usa um template próprio, inserido diretamente pelo controlador da ficha antes da ativação da interface;
- removida a dependência de condição Handlebars e de seletor CSS para decidir se o mapa deve aparecer;
- renovados os arquivos de entrada para impedir o reaproveitamento da implementação anterior pelo cache.

## 1.3.3 - 2026-07-21

### Corrigido

- o painel do mapa agora faz parte fixa da ficha e é ocultado por CSS somente para registros que não sejam Cidade;
- os arquivos de entrada, estilo e template receberam novos URLs para impedir que o cache do Foundry reutilize a interface anterior;
- o controlador interativo do mapa só é ativado em registros do tipo Cidade.

## 1.3.2 - 2026-07-21

### Corrigido

- o mapa da cidade agora é exibido pela presença direta dos dados `cityMap`, evitando a condição intermediária que impedia o bloco de ser renderizado.

## 1.3.1 - 2026-07-21

### Corrigido

- o template da ficha recebeu um novo identificador para impedir que o cache do Foundry reutilize a versão anterior e esconda o mapa das cidades.

## 1.3.0 - 2026-07-21

### Adicionado

- novo tipo `Cidade` na Biblioteca do Mestre;
- mapa privado por cidade, com imagem escolhida pelo File Picker, movimento por arraste, zoom pela roda ou teclado e ação para centralizar;
- marcadores reposicionáveis ligados por UUID às fichas do tipo `Local`;
- criação de uma nova ficha de Local diretamente pela ação de adicionar um ponto ao mapa.

### Segurança e dados

- imagens, coordenadas, zoom e UUIDs do mapa são normalizados antes da persistência em flag própria do módulo;
- remover um marcador do mapa não exclui sua ficha de Local da biblioteca.

## 1.2.0 - 2026-07-21

### Adicionado

- ajuste de enquadramento das imagens da Biblioteca do Mestre, com zoom e posição horizontal e vertical salvos automaticamente por ficha;
- ação para restaurar o enquadramento central sem alterar o arquivo original da imagem.

### Alterado

- contraste do estado vazio da biblioteca e do botão de criação de registros;
- miniaturas da biblioteca agora respeitam a posição escolhida na ficha.

## 1.1.2 - 2026-07-21

### Corrigido

- criação de cenas, colunas, cartões e blocos em ambientes hospedados sem `crypto.randomUUID()`;
- erros em ações do roteiro agora são registrados e informados ao mestre em vez de falharem silenciosamente.

## 1.1.1 - 2026-07-21

### Alterado

- controles de visualização das aventuras ampliados, com maior espaçamento e área de clique.

## 1.1.0 - 2026-07-21

### Adicionado

- detalhes da aventura integrados ao roteiro em uma barra lateral recolhível;
- imagens de capa para aventuras e modos de visualização em cartões ou lista;
- comando `/pista`, com marcadores privados que podem ser arrastados para a cena;
- abertura da cena e destaque da pista no Diário do Mestre ao ativar seu marcador;
- conclusão visual de cartões com clique duplo na barra superior.

### Alterado

- aventuras agora abrem diretamente no roteiro unificado;
- marcadores de pista apontam para a aventura privada sem criar páginas auxiliares no Journal;
- contraste do botão para criar aventuras foi ampliado.

## 1.0.0 - 2026-07-20

### Adicionado

- painel privado e unificado para o mestre;
- preparação de aventuras e roteiro visual dividido em cenas e colunas;
- blocos de texto, diálogo, seleção e teste pelo comando `/`;
- menções por UUID para registros da biblioteca, Atores e Itens;
- biblioteca reutilizável de personagens, locais, itens, encontros e facções;
- salvamento automático do roteiro e das fichas da biblioteca;
- redimensionamento horizontal e vertical das colunas;
- integração opcional com PopOut no Foundry v13 e janelas nativas no v14;
- traduções em português do Brasil e inglês.

### Segurança e dados

- operações de criação, edição e exclusão restritas ao mestre;
- conteúdo armazenado em um `JournalEntry` privado do mundo;
- HTML editável sanitizado antes da persistência.
