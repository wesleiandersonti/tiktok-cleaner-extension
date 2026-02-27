# TikTok Following Analyzer & Cleaner (Chrome Extension)

Extensao focada em **analise assistida** da lista Seguindo no TikTok.

Objetivo: ajudar o usuario a identificar contas com baixa atividade usando sinais publicos visiveis no DOM, com transparencia total de criterios e unfollow apenas com confirmacao explicita.

## Principios de seguranca e compliance
- sem APIs privadas do TikTok
- sem coleta/envio de dados para servidores externos
- sem acao automatica sem interacao do usuario
- limites diarios e delays humanos em unfollow assistido

## O que a extensao faz
1. Analisa apenas perfis visiveis na tela/lista de Seguindo.
2. Extrai sinais publicos quando disponiveis no DOM:
   - dias desde ultimo post
   - posts
   - seguidores
   - seguindo
   - curtidas
   - bio vazia
   - avatar presente
3. Calcula score de inatividade.
4. Classifica em:
   - Ativo
   - Baixa atividade
   - Provavelmente inativo
5. Permite unfollow assistido somente com:
   - selecao manual
   - confirmacao digitada (`CONFIRMAR`)
   - respeito a limite diario

## Heuristica base
- Sem posts > 180 dias: +50
- Sem posts > 90 dias: +30
- Seguidores = 0: +10
- Curtidas = 0: +10
- Bio vazia: +5
- Sem avatar: +10

Regra de classificacao:
- Score >= 60: Provavelmente inativo

## Arquitetura
- `manifest.json`: MV3 e permissoes minimas
- `content.js`: leitura de DOM + score + unfollow assistido
- `popup.js`: UI, revisao do usuario e confirmacao explicita
- `background.js`: estado local, limites diarios e aprovacao de acao

## Instalacao
1. Abra `chrome://extensions`
2. Ative **Modo do desenvolvedor**
3. Clique em **Carregar sem compactacao**
4. Selecione a pasta do projeto

## Uso rapido
1. Abra TikTok logado na pagina/lista Seguindo
2. Abra o popup da extensao
3. Clique em **Analisar perfis visiveis**
4. Revise score e criterios por perfil
5. Se quiser, selecione perfis e confirme `CONFIRMAR`
6. Clique em **Unfollow assistido (selecionados)**

## Observacoes
- A disponibilidade dos sinais depende do que o TikTok mostra no DOM no momento.
- Mudancas na interface do TikTok podem exigir ajustes de seletor.

## Testes de contrato (heuristica)
- Rodar localmente com Node:

```bash
node --test tests/inactivity-score.contract.test.js
```

- Os testes validam score, classificacao e regra de nao penalizar sinais ausentes.
