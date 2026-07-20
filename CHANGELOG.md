# Histórico de versões

Todas as alterações relevantes deste projeto serão documentadas neste arquivo.

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
