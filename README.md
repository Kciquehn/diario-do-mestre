# Diário do Mestre

Módulo para Foundry VTT v13 e v14 que organiza a preparação das sessões do mundo atual.

## Uso

1. Ative o módulo no mundo.
2. Como mestre, abra a aba **Diário** e clique em **Abrir Diário do Mestre** no rodapé. O mesmo painel também está disponível em **Configurações do módulo**.
3. Crie uma aventura e use o preparador próprio do módulo para definir objetivo, abertura, cenas, personagens, locais, encontros, itens, pistas, improvisos e notas finais.
4. Salve a preparação pelo botão no rodapé do preparador.

A interface funciona em uma única janela. Diário, Biblioteca, aventuras, roteiros e fichas próprias do módulo são organizados em abas no topo; visualizadores de imagem e fichas nativas de `Actor` ou `Item` continuam usando as aplicações próprias do Foundry.

## Roteiro da Sessão

Dentro do preparador, o botão **Roteiro da Sessão** abre uma aba interna com um quadro no estilo Trello. Cada cena vira uma aba no topo e pode receber colunas e cartões de texto. O mestre pode escrever ou colar trechos inteiros de uma aventura e digitar `/` em uma linha vazia para inserir uma **Caixa de diálogo** ou uma **Caixa de seleção**. Os cartões continuam podendo ser arrastados para outra posição ou coluna.

Cada mundo possui apenas um Diário do Mestre. Ele é criado automaticamente com a primeira sessão como um `JournalEntry` de propriedade padrão `NONE`, sem compartilhamento com jogadores. O documento nativo funciona apenas como armazenamento e fallback legível; a experiência principal é a interface própria do módulo.

## Biblioteca do Mestre

A Biblioteca do Mestre guarda referências reutilizáveis do mundo em fichas próprias:

- personagens;
- locais;
- itens;
- encontros;
- facções.

Cada ficha possui campos adequados ao tipo, imagem, notas privadas e pode ser vinculada a um `Actor` ou `Item` real arrastado do Foundry. O vínculo usa UUID e não duplica o Document original.

## PopOut! e outros monitores

Quando o módulo **PopOut!** estiver ativo, o Roteiro da Sessão exibe o botão **Outro monitor**. Ele destaca a janela unificada do Diário do Mestre mantendo aberta a aba atual. O menu de contexto das abas internas também oferece essa opção.

O PopOut! funciona quando o Foundry é acessado por um navegador comum, como `http://localhost:30000`; ele não funciona dentro do aplicativo desktop Electron. No Foundry v14, o suporte nativo a janelas destacadas continua disponível pelas opções da própria janela.
