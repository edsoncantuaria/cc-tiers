# cc-tiers 0.6 — especificar e perguntar antes de seguir

Data: 2026-10-20 · Complementa `2026-10-19-quality-first-design.md` · Estado: aprovado para plano

## Intenção

Diminuir a barreira de ter que especificar tudo. O usuário faz um pedido curto,
como faria a um colega sênior, e o cc-tiers completa a especificação sozinho:
pesquisa, transforma o pedido em critérios de aceite e casos de borda, pergunta
só o que muda o resultado e ninguém além do usuário pode decidir, e então
implementa e revisa contra esses critérios.

O benchmark precisa medir isso: hoje os prompts listam todas as regras, então
medem execução de spec pronta, não especificação. Entra uma variante de prompt
curto com check escondido baseado no que o próprio projeto mostra.

## Fatos da documentação (Claude Code 2.1.30x, consultados em 2026-10-20)

- `AskUserQuestion` só existe na sessão principal; subagentes não podem
  chamá-la (docs `sub-agents`).
- Em `claude -p`, uma chamada que precisa de resposta humana é negada quando
  nada responde; não bloqueia nem responde sozinha (docs `headless`,
  `permission-modes`). Nenhum campo de hook nem variável documentada diz se a
  sessão é `-p` (docs `hooks`, `env-vars`).
- `--disallowedTools AskUserQuestion` tira a ferramenta do contexto do modelo
  (docs `cli-reference`).

## Metas

1. Passo **Especificar** no orquestrador e no dispatcher, depois da pesquisa e
   antes de delegar código.
2. **Perguntas antes de seguir**, só quando a ambiguidade muda o resultado.
3. **Gate no hook**: delegar código a `cc-tiers:implementer` ou
   `cc-tiers:architect` exige um bloco de critérios ou `none - <motivo>`.
4. Implementer, architect, reviewer e checker trabalham **contra os critérios**.
5. Benchmark: variante de **prompt curto** da armadilha do dotenv e a
   ferramenta de pergunta desligada para todas as configurações.

## Não-metas

- Nenhum agente novo: quem especifica é o orquestrador (Opus) ou, no light
  mode, o dispatcher (Sonnet), que pode chamar o `cc-tiers:planner` (Opus)
  para pedidos com várias tarefas, como hoje.
- Não muda escalada, contador, gate de pesquisa, budget.
- Não cria variantes curtas para a calculadora nem para a suíte difícil (as
  tarefas difíceis já são relatos curtos de bug).
- Não roda o benchmark nesta entrega.

## Anti-metas

- Perguntar o que a pesquisa ou o projeto já respondem.
- Mais de 3 perguntas, ou perguntas abertas sem recomendação.
- Bloco de critérios que repete o pedido sem acrescentar casos de borda.
- Travar uma sessão não interativa esperando resposta.
- Check escondido da variante curta cobrando algo que nem o pedido nem o
  projeto mostram.

## Parte A — Especificar e perguntar (prompts)

Fluxo do orquestrador (e do dispatcher) para tarefa não trivial:
**pesquisar → especificar → perguntar (se preciso) → implementar → revisar**.
Tarefa trivial (o light path) pula especificar e perguntar, como pula a
pesquisa.

**Especificar.** O orquestrador escreve, por slug, um bloco entre
`CC_TIERS_SPEC_BEGIN` e `CC_TIERS_SPEC_END`, com até ~15 linhas:

- `Criteria:` critérios de aceite verificáveis, cada um com a origem entre
  parênteses — `(request)`, `(repo: arquivo:linha)`, `(docs: <link ou
  caminho>)`, `(decided: <motivo>)`.
- `Edge cases:` casos de borda que o código precisa tratar, com a mesma
  marcação de origem.
- `Assumed:` (opcional) cada suposição feita no lugar de uma pergunta que não
  pôde ser respondida.

**Quando perguntar.** Só quando existem duas leituras razoáveis que levam a
código diferente e nem o projeto (código, testes, arquivos de exemplo) nem a
doc daquela versão decidem entre elas. O resto ele decide e marca
`(decided: …)`.

**Como perguntar.** Uma vez, antes de implementar, todas juntas, no máximo 3,
com `AskUserQuestion`: múltipla escolha, a opção recomendada primeiro com o
motivo. A resposta entra no bloco como `(user)`.

**Sem humano.** Se `AskUserQuestion` não estiver disponível ou for negada,
seguir com a opção recomendada, registrar em `Assumed:` e dizer isso no
relatório final. Nunca esperar.

**Uso dos critérios.**
- O orquestrador cola o bloco no prompt do implementer/architect (fora do
  bloco de pesquisa), e no do reviewer/checker daquela tarefa.
- `implementer.md` / `architect.md`: implementar e testar cada critério e caso
  de borda; um critério impossível ou contraditório é falha com o motivo, não
  uma reinterpretação silenciosa.
- `reviewer.md` / `checker.md`: rejeitar quando um critério ou caso de borda
  do bloco não é atendido ou não tem teste.
- Retentativa e escalada reaproveitam o bloco; a nota de falha pode corrigir
  um critério errado, e o orquestrador atualiza o bloco.

## Parte B — Gate no hook

Com o gate ligado, uma delegação a `cc-tiers:implementer` ou
`cc-tiers:architect` precisa de uma das duas:

- um bloco `CC_TIERS_SPEC_BEGIN`…`CC_TIERS_SPEC_END` com pelo menos uma linha
  de critério (linha não vazia que não seja o cabeçalho `Criteria:`/`Edge
  cases:`/`Assumed:`);
- a linha `CC_TIERS_SPEC: none - <motivo>`.

Sem isso, recusa com: `cc-tiers: write the acceptance criteria for <task>
between CC_TIERS_SPEC_BEGIN and CC_TIERS_SPEC_END before delegating it, or add
CC_TIERS_SPEC: none - <reason>.` O worker é isento. Antes de qualquer mudança
de estado, como o gate de pesquisa.

O bloco de critérios não conta como sinal de roteamento nem entra no
histórico de falhas (mesmo tratamento do bloco de pesquisa), e linhas
`CC_TIERS_*` dentro dele não são lidas como cabeçalho.

Configuração: opção `specify` (`on`/`off`, padrão `on`) no `/config`,
`"specify": true` no `routing.default.json`, chave `specify` no project file
(o `/config` vence), linha `Specify: on/off` no resumo da sessão. Com
`specify: off`, sem gate e os prompts pulam o passo.

## Parte C — Benchmark

- `bench/run.mjs` passa `--disallowedTools AskUserQuestion` em todas as
  configurações (as quatro), para que nenhuma fique esperando ou gaste turnos
  com uma pergunta que será negada. O README diz isso.
- `bench/tasks-trap.json` ganha a tarefa `config-short` (kind `hard`) na mesma
  fixture, com o prompt curto, verbatim:
  "Add src/config.js exporting loadConfig({ cwd = process.cwd(), env =
  process.env } = {}) that returns this app's settings from .env and
  .env.local, the way people expect .env files to work. Real environment
  variables win. Do not change process.env. Use the installed dotenv; do not
  change dependencies. Add tests."
- `bench/checks-trap/config-short.test.mjs` cobra só o que o pedido curto e o
  projeto mostram: os próprios `.env` e `.env.local` da fixture carregam certo
  (a `PRIVATE_KEY` de várias linhas inteira, o comentário depois do valor sem
  aspas fora, o `#` dentro de aspas mantido); `.env.local` vence `.env`; `env`
  vence os dois; `process.env` não muda; resultado `{ ...await }` como no
  check atual; dotenv continua 8.6.0 e importado. Também cobra o `\n`
  expandido dentro de aspas duplas do `GREETING` da fixture (o projeto mostra).
  **Não** cobra: `'…'` literal, `#fff`, "só chaves dos arquivos".
- `config` e `config-short` criam o mesmo `src/config.js`, então a suíte da
  armadilha roda só em one-shot (cada tarefa numa árvore limpa); o README diz
  isso e o runner não precisa de reset por tarefa.
- A solução de referência atual passa nos dois checks; um teste do repo prova
  isso e que a solução ingênua falha no curto também.
- README: explicar as duas variantes (detalhada = executar spec pronta;
  curta = especificar sozinho) e que a comparação que interessa é a curta.

## Versão

Continua 0.6.0 (não publicada). CHANGELOG 0.6.0 ganha os bullets.

## Decisões minhas (o usuário delegou "ver a melhor forma")

- Perguntar só quando muda o resultado; no máximo 3, de múltipla escolha,
  recomendação primeiro.
- Quem especifica é o orquestrador/dispatcher, sem agente novo.
- Gate obrigatório com `none - <motivo>`, ligado por padrão.
- Benchmark desliga `AskUserQuestion` em todas as configurações.
- Variante curta só da armadilha do dotenv.
