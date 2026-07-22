# Histórico de versões

Todas as alterações relevantes deste projeto serão documentadas neste arquivo.

## 1.11.1 - 2026-07-22

### Alterado

- o controle de redimensionamento dos pins no mapa da Cidade agora aparece mais próximo do nome do local.

## 1.11.0 - 2026-07-22

### Adicionado

- o Diário dos Jogadores agora exibe a categoria **Comércio** sempre que o Item Piles ou Item Piles: Symbaroum estiver ativo;
- comerciantes existentes no provedor ativo são carregados automaticamente como fichas consultáveis, sem exigir uma publicação duplicada;
- fichas de comércio já publicadas pelo Diário continuam sendo reutilizadas e não aparecem duas vezes;
- criações, exclusões e alterações em comerciantes ou seus itens atualizam o Diário dos Jogadores aberto.

## 1.10.1 - 2026-07-22

### Adicionado

- a imagem da aventura na barra lateral do roteiro agora pode ser redimensionada verticalmente pelo mouse;
- a alça também aceita as setas para cima e para baixo, com limites seguros entre 72 e 420 pixels;
- a altura escolhida é salva automaticamente em cada aventura e reaplicada ao abrir o roteiro.

## 1.10.0 - 2026-07-21

### Adicionado

- comércios publicados agora exibem o catálogo do Item Piles diretamente dentro do Diário dos Jogadores;
- jogadores podem escolher preço, quantidade e comprar para o personagem que lhes foi atribuído sem sair do diário;
- estoque, preços alternativos, recursos disponíveis e estado aberto ou fechado continuam sendo calculados pelo Item Piles ou Item Piles: Symbaroum.

### Segurança

- a compra usa exclusivamente a API pública `tradeItems` do provedor ativo, preservando as regras, moedas, transferências, sockets e validações do Item Piles;
- UUID, item, personagem, estoque, preço e disponibilidade são revalidados imediatamente antes da operação.

## 1.9.3 - 2026-07-21

### Alterado

- comerciantes criados pela Biblioteca do Mestre agora são organizados automaticamente na pasta de Atores **Comerciantes do Mestre**;
- a pasta é criada apenas quando necessário e reutilizada nas próximas criações, inclusive com Item Piles: Symbaroum.

## 1.9.2 - 2026-07-21

### Alterado

- fichas de Personagem agora usam um layout compacto, com retrato, identidade e Actor vinculado reunidos no cabeçalho;
- papel, aparência, personalidade, motivação, segredos e anotações privadas foram organizados em seções recolhíveis;
- publicação no Diário dos Jogadores, edição enriquecida, comandos e salvamento automático foram preservados no novo layout.

## 1.9.1 - 2026-07-21

### Corrigido

- fichas de Cidade agora abrem a aba imediatamente e carregam o mapa após a interface ficar visível;
- mapas de cidades mantidos em abas ocultas não são inicializados durante uma nova renderização do Diário;
- a área do mapa foi isolada para reduzir recálculos de layout e o uso permanente de camadas gráficas pesadas.

## 1.9.0 - 2026-07-21

### Adicionado

- a criação de registros da Biblioteca do Mestre agora oferece **Comerciante/Loja** quando uma variante compatível do Item Piles está ativa;
- o novo fluxo usa a API pública do Item Piles para criar um Actor comerciante com os padrões do sistema e uma ficha de Local do tipo Loja já vinculada a ele.

### Segurança

- a opção permanece oculta quando não há provedor compatível, quando a integração ainda não está pronta ou quando as duas variantes estão ativas simultaneamente;
- se a criação da ficha da biblioteca falhar, o Actor recém-criado é removido para não deixar dados incompletos no mundo.

## 1.8.0 - 2026-07-21

### Adicionado

- Actors e Itens do mundo agora podem ser arrastados para a Biblioteca do Mestre para criar fichas vinculadas com nome, imagem e UUID;
- soltar um documento no Diário dos Jogadores cria ou reutiliza a ficha privada correspondente e a publica automaticamente;
- Actors com proprietário jogador são classificados como Personagens do grupo; os demais são criados como Personagens comuns.

### Alterado

- páginas públicas agora guardam a referência da ficha privada de origem, evitando duplicações e preservando a sincronização ao editar, despublicar ou excluir.

## 1.7.0 - 2026-07-21

### Adicionado

- seção permanente **O Grupo** como primeira opção do menu Explorar no Diário dos Jogadores;
- novo registro **Personagem do grupo**, com imagem, Actor vinculado, papel, biografia, história, personalidade, objetivos e relações;
- fichas publicadas do grupo podem ser pesquisadas, abertas no mural e consultadas em páginas detalhadas.

## 1.6.2 - 2026-07-21

### Alterado

- o cabeçalho da interface pública agora exibe “Diário dos Jogadores” em vez do nome do mundo.

## 1.6.1 - 2026-07-21

### Alterado

- a configuração de comerciante nas fichas de Local e os recursos de comércio no Diário dos Jogadores agora só aparecem quando o Item Piles ou o Item Piles: Symbaroum está ativo no mundo.

## 1.6.0 - 2026-07-21

### Adicionado

- Diário dos Jogadores redesenhado como mural social e wiki pesquisável da campanha;
- busca por nome e conteúdo, navegação por categorias e páginas detalhadas de cada descoberta;
- novo registro de Publicação para relatos de sessão, notícias e crônicas;
- publicação opcional de personagens, locais, cidades, itens, encontros, facções e comércios.

### Segurança

- cada tipo possui uma lista explícita de campos públicos; segredos e anotações privadas nunca são copiados para o diário dos jogadores;
- páginas públicas antigas de comércio continuam disponíveis e são migradas ao serem atualizadas.

## 1.5.1 - 2026-07-21

### Alterado

- o cadeado de um marcador travado agora fica oculto em repouso e reaparece somente ao passar o mouse ou focar o marcador.

## 1.5.0 - 2026-07-21

### Adicionado

- Diário dos Jogadores com uma área pública de comércios conhecidos;
- vínculo entre uma ficha de Local do tipo Loja e um comerciante do Item Piles;
- suporte opcional ao Item Piles original e ao Item Piles: Symbaroum.

### Segurança

- somente localização, descrição, serviços, nome e imagem são publicados; segredos e anotações privadas permanecem no Diário do Mestre;
- a integração é bloqueada quando as duas variantes do Item Piles estão ativas simultaneamente.

## 1.4.10 - 2026-07-21

### Alterado

- arrastar sobre um marcador bloqueado agora move o mapa, sem alterar a posição do local;
- marcadores bloqueados continuam revelando o nome ao passar o mouse;
- remover e redimensionar ficam ocultos enquanto o cadeado estiver fechado.

## 1.4.9 - 2026-07-21

### Alterado

- a área de Actor ou Item vinculado foi movida para um botão compacto no canto superior direito da ficha;
- o novo botão continua aceitando documentos arrastados e abre a ficha vinculada ao ser acionado;
- o bloco largo anteriormente exibido abaixo do cabeçalho foi removido.

## 1.4.8 - 2026-07-21

### Alterado

- os botões de visualização das Aventuras agora possuem fundo, borda e ícones com maior contraste;
- os estados ativo, inativo, foco e passagem do mouse ficaram visualmente distintos.

## 1.4.7 - 2026-07-21

### Alterado

- a área do mapa da Cidade agora acompanha automaticamente a proporção real da imagem;
- mapas passam a ocupar toda a largura disponível sem faixas laterais nem recorte;
- imagens maiores preservam a proporção e usam a qualidade de interpolação padrão do navegador.

## 1.4.6 - 2026-07-21

### Adicionado

- cada marcador do mapa de Cidade agora possui um cadeado persistente;
- marcadores bloqueados não podem ser movidos nem redimensionados até serem desbloqueados;
- o cadeado fechado permanece visível para indicar quais locais estão fixados.

## 1.4.5 - 2026-07-21

### Adicionado

- fichas de Local agora possuem um botão para recolher ou expandir o cabeçalho;
- o estado do cabeçalho é salvo individualmente em cada Local;
- no layout Lateral, os campos passam a ocupar toda a largura quando o cabeçalho é recolhido.

## 1.4.4 - 2026-07-21

### Alterado

- fichas de Local não exibem nem aceitam mais documentos vinculados;
- vínculos antigos de Locais são ignorados e removidos no próximo salvamento automático;
- os layouts foram ajustados para aproveitar o espaço anteriormente ocupado pelo vínculo.

## 1.4.3 - 2026-07-21

### Adicionado

- novo layout Lateral para fichas de Local, com imagem alta à esquerda e todo o conteúdo organizado à direita;
- adaptação responsiva que converte o layout lateral em uma coluna nas janelas estreitas;
- os controles de enquadramento continuam acessíveis sobre a área da imagem lateral.

## 1.4.2 - 2026-07-21

### Adicionado

- cada ficha de Local agora permite escolher entre os layouts Editorial, Panorâmico e Compacto;
- a preferência visual é salva na própria ficha e reaplicada automaticamente em qualquer cliente;
- a troca de layout acontece imediatamente, sem recarregar ou interromper o salvamento automático.

## 1.4.1 - 2026-07-21

### Alterado

- a ficha de Local ganhou um layout editorial com imagem maior, identidade e documento vinculado reunidos no cabeçalho;
- os campos de conteúdo foram reorganizados em cartões mais legíveis, mantendo duas colunas em telas largas e uma coluna em telas estreitas;
- o enquadramento de imagem e todos os fluxos de edição, vínculo e salvamento automático foram preservados.

## 1.4.0 - 2026-07-21

### Adicionado

- fichas de Local agora possuem categorias para lojas, edifícios, áreas naturais, regiões, bairros, rotas, ruínas e pontos de interesse;
- o tipo escolhido é validado e salvo junto da ficha, com “Local genérico” como padrão seguro para registros antigos.

### Alterado

- os campos da ficha de Local foram renomeados para atender desde estabelecimentos pequenos até regiões inteiras sem alterar os dados já preenchidos.

## 1.3.12 - 2026-07-21

### Alterado

- nomes dos locais no mapa da Cidade ficam recolhidos por padrão e aparecem ao passar o mouse sobre o marcador;
- a mesma revelação ocorre ao focar, mover ou redimensionar o marcador, preservando o uso por teclado e as animações existentes.

## 1.3.11 - 2026-07-21

### Adicionado

- marcadores de Local no mapa da Cidade agora possuem uma alça para redimensionamento individual;
- arrastar a alça ajusta livremente o tamanho entre 60% e 200%, enquanto clicar alterna tamanhos rapidamente;
- o tamanho de cada marcador é salvo no mapa, com valor padrão seguro para locais criados em versões anteriores.

## 1.3.10 - 2026-07-21

### Alterado

- o cabeçalho das fichas de Cidade não exibe mais retrato nem controles de enquadramento;
- o cabeçalho de Cidade foi compactado para mostrar somente o tipo e o nome;
- os demais tipos de registro preservam suas imagens e controles atuais.

## 1.3.9 - 2026-07-21

### Alterado

- fichas de Cidade não exibem nem aceitam mais o bloco “Documento vinculado”;
- os demais tipos de registro continuam permitindo vínculo com Actor ou Item do Foundry;
- abertura de imagem e ativação dos listeners agora tratam corretamente fichas sem o campo de vínculo.

## 1.3.8 - 2026-07-21

### Corrigido

- o grid da ficha usa linhas `max-content`, impedindo que o painel do mapa seja comprimido para poucos pixels;
- o conteúdo do diálogo “Adicionar local” agora usa uma raiz sem atributos, conforme o contrato do `DialogV2` no Foundry v13;
- painel do mapa, seletor de imagem e diálogo de local foram verificados diretamente em execução no Foundry v13 Build 351 pelo Brave.

## 1.3.7 - 2026-07-21

### Corrigido

- desativada temporariamente a ancoragem automática de scroll durante a inserção do mapa da Cidade;
- a área de campos agora volta ao topo imediatamente e no próximo frame, garantindo que o mapa recém-inserido seja a primeira seção visível;
- preservadas todas as entradas de compatibilidade das versões anteriores.

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
