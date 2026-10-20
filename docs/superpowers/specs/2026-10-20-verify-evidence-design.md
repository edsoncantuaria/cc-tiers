# cc-tiers 0.7 — gate de verificação, revisão com evidência e ablação

Data: 2026-10-20 · Complementa `2026-10-19-quality-first-design.md` e `2026-10-20-specify-design.md` · Estado: rascunho para revisão

## Intenção

Hoje um "pass" é a palavra do agente: o hook aceita `CC_TIERS_STATUS: pass`
sem rodar nada, e o reviewer rejeita com "uma razão concreta" que pesa igual,
tenha prova ou não. A 0.7 troca opinião por evidência em dois pontos:

- **P0, gate:** o hook roda ele mesmo o comando de verificação que o agente
  declarou, e um pass só vale se esse comando passar.
- **P1, revisão com evidência:** uma rejeição só conta como falha quando traz
  um defeito bloqueante com reprodução. Sem reprodução, vira nota.

E o benchmark mede se isso mudou a qualidade contra o Opus sozinho.

### Por que (registros do usuário, `~/.claude/registros/`, set–out 2026)

- Os defeitos reais vieram de revisão e QA com a suíte verde: flow-api #11
  (907 testes OK, 5 defeitos de estado/ordem/idempotência achados em revisão),
  QA caixa-preta do flow (≈1090 testes verdes, `user:pass@` na URL e 500 com
  descrição > 255). Por isso P1 pesa tanto quanto P0.
- Falsos positivos de revisão eram opinião sem reprodução: phpstan num
  nullable que o nível 6 não cobre, "falso alarme" de ACL, `defaultValue` em
  jsonb que quebraria no HomeBaked v2.15.9.
- Um defeito com boa reprodução pode vir com correção errada (flow-api PR #65):
  o revisor aponta o defeito, quem corrige escolhe a correção.
- Revisões que crescem: #11 teve 4 rodadas; parte dos achados era para outra
  issue.
- Testes intermitentes existem (flow-api, Playwright); há verificações que
  nenhum comando faz (gravar no aparelho no openbridge, conferir no Chrome no
  qualicheck).
- Várias sessões já dividiram o mesmo checkout (commits na branch errada,
  porta serial disputada).

## Fatos da documentação (Claude Code, `code.claude.com/docs/en/hooks`, 2026-10-20)

- `timeout` de hook `command`: padrão 600 s (30 s em `UserPromptSubmit`). Hoje
  o `hooks.json` do cc-tiers usa 15 s em todos.
- `PostToolUse` pode devolver `additionalContext`, `decision: "block"` com
  `reason`, e `updatedToolOutput`, que substitui o resultado da ferramenta.
- Um hook é um comando que o usuário instalou; não passa pelas regras de
  permissão do Claude Code. Por isso o gate não pode rodar qualquer texto que
  o agente escrever.

## Metas

1. **Declaração de verificação** em todo relatório de quem escreve código
   (worker, implementer, architect, teto do Opus, dispatcher).
2. **Gate no hook:** roda os comandos declarados quando o relatório é `pass`.
3. **Lista de prefixos permitidos** em `/config`.
4. **"Não validado" explícito** no relatório final.
5. **Achados estruturados** no reviewer e no checker, com categoria,
   severidade e evidência.
6. **Rejeição sem evidência não conta**; evidência por comando é conferida
   pelo hook.
7. **Benchmark:** `opus` × `cc-tiers` (0.7) nas 8 tarefas não triviais da
   suíte difícil, k=2, com métricas por camada.

## Não-metas

- Rodar a suíte no escopo da CI (decisão do usuário: "remove o CI"). O gate
  roda só o que o agente declarou para a área tocada.
- Adivinhar o comando de teste do projeto. O comando vem do agente, que o tira
  do projeto (README, Makefile, `package.json`, mapa do repo).
- Property-based ou mutation testing.
- Isolar sessões paralelas no mesmo checkout. O gate não resolve isso; a falha
  aponta que outra tarefa pode ser a causa (ver Limitações).
- Configs de ablação por camada (`-gate`, `-evidence`, `@0.6.0`). O usuário
  escolheu só `opus` e `cc-tiers`; o efeito de cada camada sai das métricas
  por camada dentro do `cc-tiers`.
- Arquivo de configuração novo dentro do projeto. O usuário proíbe `.claude/`
  em `~/Projetos/**`; a P0 e a P1 ficam em `/config`.

## Antimetas (falha mesmo funcionando)

- Gate que reprova por erro pré-existente (phpstan do flow-api parte de
  948–1133 erros): o comando declarado é o focado na área, não o projeto todo.
- Gate que roda um comando fora da lista do usuário.
- Revisão que continua reprovando por endurecimento que o pedido não pediu.
- Hook que trava a sessão: todo comando tem timeout e o hook nunca falha a
  chamada por erro próprio (`onFailure: continue`, como hoje).

## P0 — gate de verificação

### Declaração

O relatório de worker, implementer e architect, e o trailer do teto do Opus e
do dispatcher, ganham linhas `CC_TIERS_VERIFY`, antes de `CC_TIERS_STATUS`:

```
CC_TIERS_VERIFY: node --test test/booking.test.mjs
CC_TIERS_VERIFY: npx tsc --noEmit
CC_TIERS_STATUS: pass
```

- Uma linha por comando. Sem `;`, `|`, redirecionamento, substituição ou
  `&&` fora do caso abaixo: o hook recusa a linha que tiver qualquer
  metacaractere de shell.
- Duas formas que o agente escreve naturalmente são aceitas e interpretadas
  pelo hook, sem shell (decisão minha):
  - `KEY=valor` no começo vira variável de ambiente do comando
    (`APP_ENV=testing vendor/bin/phpunit`);
  - `cd <dir> && <comando>` roda o comando em `<dir>`, que tem de ser relativo
    e ficar dentro do projeto (`cd api && npm test`).
  A lista de prefixos é conferida no comando depois de tirar essas duas partes.
  Em container, o caminho é `docker exec -w <dir> ...` com `docker exec` na
  lista.
- `CC_TIERS_VERIFY: none - <motivo>` quando nenhum comando verifica a mudança
  (gravar no aparelho, tela conferida à mão, uma busca que não mudou arquivo).
- O comando é o focado na área tocada, o mesmo que o agente rodou. O prompt
  do agente diz isso.

### Quando o gate roda

- Só quando o relatório é `pass`. Um `fail` já é falha.
- Relatório `pass` **sem nenhuma** linha `CC_TIERS_VERIFY` conta como falha:
  `cc-tiers: <slug> reportou pass sem declarar verificação`.
- `none - <motivo>`: não roda nada; a tarefa entra na lista de "não validado"
  com o motivo.
- O caminho leve inline (tarefa trivial feita na própria sessão, sem slug)
  fica fora do gate, como fica fora da pesquisa e do spec.

### Como roda

- Cada comando roda sem shell (argv), no diretório do projeto
  (`CLAUDE_PROJECT_DIR`, ou o `cwd` do payload), com timeout por comando de
  `verify_timeout` segundos (opção nova, padrão 300).
- Comando que sai ≠ 0 roda **mais uma vez**. Passou na segunda: pass, com a
  nota `instável: <comando>` no relatório final. Falhou nas duas: falha.
- Timeout de um comando conta como falha, com a razão `timeout após N s`
  (um teste que trava é defeito ou ambiente quebrado; nos dois casos o pass
  não vale).
- Orçamento total por relatório: `verify_budget` segundos (opção nova, padrão
  600), somando todos os comandos e a segunda tentativa. Quando acaba, os
  comandos que faltam não rodam e entram em "não validado" com
  `orçamento esgotado`, **sem** contar falha (decisão minha: tempo de suíte
  lenta não deve empurrar a tarefa para o Opus). O `timeout` das entradas do
  `hooks.json` que rodam o gate fica acima desse orçamento, para o hook nunca
  ser morto antes de contar.
- Comando cujo prefixo não está na lista: não roda, a tarefa entra em
  "não validado" com `fora da lista: <comando>`, e **não** conta como falha. A
  mensagem diz como acrescentar o prefixo em `/config`.
- Na falha, a nota da próxima tentativa leva o comando, o código de saída e as
  últimas ~40 linhas da saída. Ela segue pelo mesmo caminho das falhas de hoje
  (contador, escada de esforço, escalada).

### Lista de prefixos

Opção `verify_allow` (string, separada por vírgula). Um comando passa quando
começa por um item da lista, comparando por palavras inteiras (`npm test` casa
`npm test -- x`, não `npm testx`).

Padrão (decisão minha, para funcionar sem configurar em Node e PHP):
`npm test, npm run test, node --test, npx tsc, npx eslint, npx vitest,
npx jest, npx playwright test, vendor/bin/phpunit, ./vendor/bin/phpunit,
vendor/bin/phpstan, ./vendor/bin/phpstan, vendor/bin/phpcs, ./vendor/bin/phpcs,
pytest, python -m pytest, go test, cargo test`.

`docker exec` **não** está no padrão: com ele, qualquer comando roda no
container. O usuário acrescenta em `/config` se quiser (é o caso do flow-api
e do qualicheck).

Limitação, para o README: a lista restringe a forma do comando, não o que o
teste executa. Um teste é código do repositório, e o agente já pode escrever
código. A lista evita que o hook rode, fora das permissões, um comando que não
é de verificação.

### Onde roda

- Delegações (`after_agent.mjs`, `subagent_stop.mjs` para background): no
  mesmo ponto em que o trailer é lido e a falha é contada. O `timeout` dessas
  entradas no `hooks.json` sobe o bastante para os comandos (deixo o número
  ao builder, coerente com `verify_timeout` × comandos × 2 tentativas).
- Teto do Opus e dispatcher: o trailer deles é lido no scan do transcript,
  que roda em todo hook e sob uma trava que vence em 10 s. O gate desses
  trailers não roda no scan: o scan só marca o relatório como "aguardando
  verificação", e o gate roda **no `Stop`, fora da trava**, gravando o
  resultado depois numa trava curta. Até lá o relatório não conta nem como
  pass nem como falha. Se reprovar, o `Stop` bloqueia uma vez com a nota
  (como já faz com pendências), e o orquestrador tenta de novo. Aceito que o
  veredito chegue no fim do turno (decisão minha).
- `verify` (`on` / `off`, padrão `on`) desliga tudo isso.

### Relatório final

O resumo de cada tarefa diz `verificado: <comandos>`, `instável: <comando>`
ou `não validado: <motivo>`. O orquestrador repete isso na resposta ao
usuário; o prompt dele passa a exigir.

## P1 — revisão com evidência

### O que o reviewer recebe

O diff, o bloco de spec, o bloco de pesquisa e o pedido. **Não** recebe o
relatório nem a explicação do implementer. O prompt do orquestrador diz isso.

### Formato dos achados

`agents/reviewer.md` e `agents/checker.md` passam a percorrer, nesta ordem:
corretude (spec e casos de borda), regressão, segurança, estado/concorrência
(ordem, idempotência, atomicidade), escopo (fora do pedido ou da arquitetura).
Cada achado sai num bloco, antes do trailer:

```
CC_TIERS_FINDING_BEGIN
category: state
severity: blocking
evidence: command
command: node --test test/booking.test.mjs
expected: o segundo evento antigo não fecha o turno reaberto
observed: o teste 'reopen keeps open' falha: expected open, got closed
where: src/booking.js:142
CC_TIERS_FINDING_END
```

- `category`: `correctness`, `regression`, `security`, `state`, `scope` (o plugin é em inglês; decisão minha).
- `severity`: `blocking` ou `note`; abaixo, "bloqueante" = `blocking` e "ressalva" = `note`.
- `evidence`, um de três:
  - `command`: com `command:`, um comando no mesmo formato do
    `CC_TIERS_VERIFY`, mais `expected`, `observed`, `where`;
  - `trace`: entrada concreta, `expected`, `observed` e
    `where: arquivo:linha`, sem comando;
  - `coverage`: um critério ou caso de borda do bloco de spec que nenhum teste
    exercita. Campos `criterion:` (o texto da linha do spec, copiado) e
    `where:` (os testes que o reviewer leu). O hook confere que `criterion`
    aparece no bloco de spec daquela tarefa; se não aparece, não vale
    (decisão minha: é o único jeito de rejeitar "não testado" sem um
    `observed`, e amarrar ao spec impede que vire endurecimento que o pedido
    não pediu). Também cobre o teste declarado no `CC_TIERS_VERIFY` que não
    toca a mudança, quando isso deixa um critério sem teste.
- O achado descreve o defeito, nunca a correção.
- Endurecimento que o spec não pede, estilo, e o que é de outra issue são
  sempre `ressalva`.
- O reviewer não edita arquivos. Pode rodar comandos de leitura e testes que
  já existem. Não escreve teste novo no repo (limitação aceita).

### O que o hook faz com uma rejeição

- `CC_TIERS_STATUS: fail` conta como falha **só se** houver ao menos um achado
  `bloqueante` válido.
- Achado `bloqueante` com `evidence: command`: se o comando está na lista, o
  hook roda (sem a segunda tentativa). Se **passa**, o achado é descartado
  como falso positivo. Se falha, vale. Se está fora da lista, vale como
  `trace`.
- Achado `bloqueante` com `trace` completo (todos os campos): vale. O hook não
  consegue conferir; aceita.
- Achado `bloqueante` com `coverage`: vale quando `criterion` está no bloco de
  spec da tarefa. Tarefa com `CC_TIERS_SPEC: none` não admite `coverage`.
- Bloco incompleto ou malformado: não vale.
- `fail` sem achado bloqueante válido: **não** é falha. O resumo diz
  `revisão sem evidência: <n> achados viraram nota`, e o orquestrador trata a
  tarefa como aprovada.
- `ressalva` nunca conta; vai para o relatório final como lista.
- A nota de falha enviada ao implementer leva só os achados bloqueantes
  válidos.

### Opção

`review_evidence` (`on` / `off`, padrão `on`). `off` volta ao comportamento
da 0.6: qualquer `fail` do reviewer conta.

## Benchmark

- Configs: `opus` e `cc-tiers` (esta versão). Nenhuma config nova no
  `CONFIGS` de `bench/run.mjs`.
- Tarefas: as 8 não triviais de `bench/tasks-hard.json` — `race`, `cancel`,
  `instances`, `traversal`, `date-filter`, `csv-escape`, `offboarding`,
  `recurring-pack`. k=2 → 32 execuções. Resultado em
  `bench/results/verify-evidence.json`.
- O fixture usa `node --test`, que está na lista padrão; a execução não precisa
  configurar nada.
- Métricas novas, lidas do estado do hook ou do transcript, só para `cc-tiers`:
  - **pass barrado pelo gate:** relatórios `pass` que o gate reprovou.
  - **instável:** comandos que passaram só na segunda.
  - **não validado:** tarefas com `none` ou fora da lista.
  - **rejeição descartada:** achados bloqueantes cujo comando passou.
  - **rejeição sem evidência:** `fail` sem achado bloqueante válido.
  - **rodadas de revisão por tarefa.**
- As métricas de hoje continuam (pass@1, Δ vs Opus, pass^k, resolvido,
  quebrou algo, recriou código, tokens por tarefa resolvida).
- README (EN e pt-BR) ganha a tabela medida e uma leitura honesta: no par
  `traversal`+`race` o Opus sozinho fez 6/6, então empate em qualidade é um
  resultado possível e será reportado como tal.
- Rodar o benchmark gasta a janela de uso do usuário. O plano marca essa
  etapa como a última, depois de `npm test` verde.

## Testes

`npm test` (`tests/cc_tiers.test.mjs`) cobre, no mínimo:

- parse de `CC_TIERS_VERIFY` (comando, `none`, metacaractere recusado);
- casamento com a lista de prefixos por palavra inteira;
- pass sem verificação → falha; comando falha duas vezes → falha; falha e
  passa → instável; fora da lista → não validado, sem falha; timeout → falha;
- parse de `CC_TIERS_FINDING` (completo, incompleto, malformado);
- `fail` sem bloqueante válido → não é falha; comando de evidência que passa →
  descartado; que falha → falha; `trace` completo → falha;
- `verify: off` e `review_evidence: off` voltam ao comportamento da 0.6.

## Limitações (vão para o README)

- Sessões paralelas no mesmo checkout: um comando pode falhar por causa de
  outra tarefa. A mensagem de falha do gate diz isso quando há outra tarefa
  ativa no estado da sessão.
- O gate prova que o comando declarado passa, não que ele cobre a mudança. Um
  agente pode declarar um teste que não toca o que mudou. A revisão continua
  sendo quem pega isso.
- Evidência `trace` não é conferida pelo hook.

## Fica para o builder

- Nomes de funções e como dividir o código entre `cc_tiers.mjs` e os
  entrypoints.
- O `timeout` exato das entradas do `hooks.json`.
- Se o teto do Opus é verificado no `Stop` ou em outro ponto (com o porquê).
- Texto exato dos prompts dos agentes, mantendo o estilo dos atuais.
- Versão 0.7.0 no `plugin.json`, `CHANGELOG.md`, README EN e pt-BR.

## Adendo — código limpo sem pedir (2026-10-20)

- Objetivo: o usuário faz um pedido curto e o código sai limpo sem ele pedir
  nem escrever regras no CLAUDE.md do projeto.
- Pesquisador: o briefing ganha Reuso (helpers existentes, `arquivo:linha`),
  Convenções (trechos próximos) e a forma que a versão instalada recomenda ou
  marca como obsoleta. Limite de cerca de 40 linhas.
- Quem escreve: reaproveita ou estende, nunca forka; segue a doc da versão e as
  convenções do arquivo; mexe só no que a tarefa exige; sem proteção hipotética
  (retry, cache, fallback, compatibilidade só com consumidor real); comentário só
  para o que o código não diz; para quando está verificado.
- Decisão do usuário: código recriado e mudança fora da tarefa são bloqueantes
  (achados `scope`). Proteção hipotética, estilo, ruído de comentário e gosto de
  nome são notas e não reprovam a tarefa.
- Benchmark: coluna `Touched outside scope`, com escopo = arquivos da solução de
  referência + `scopeExtra` + diretórios de teste. Limite: uma correção
  alternativa legítima em outro arquivo conta; o JSON bruto lista os arquivos.
  Legibilidade e qualidade de comentário não têm métrica determinística.
