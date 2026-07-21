# Histórico de versões

Todas as alterações relevantes deste projeto serão documentadas neste arquivo.

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
