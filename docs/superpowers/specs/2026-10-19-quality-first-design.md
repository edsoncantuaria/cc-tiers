# cc-tiers 0.6 — qualidade primeiro

Data: 2026-10-19 · Estado: aprovado para plano

## Intenção

O cc-tiers nasceu vendido como economia ("cada tarefa no tier mais barato que
termina"). O público real é quem assina **Pro ou Max**: não paga por token, paga
com a janela de 5h/7d, e quer **respostas mais corretas e menos retrabalho**. A
0.6 reposiciona o plugin como um orquestrador + agentes cujo objetivo é
qualidade:

- Opus planeja e revisa, Sonnet constrói, Haiku faz o mecânico.
- **Pesquisa antes de supor:** antes de escrever código que toca lib, framework
  ou API, um agente confere a versão instalada, a doc daquela versão, o uso no
  repo e quem já resolveu o mesmo problema. Fim do "não funciona porque é outra
  versão".
- O benchmark passa a medir **qualidade** (métricas padrão do mercado) e mostra
  tokens só como o preço dessa qualidade.

## Metas

1. README (EN e pt-BR), `plugin.json` e `package.json` contam a história de
   qualidade. O dólar sai da vitrine.
2. Padrões que favorecem qualidade.
3. Agente `cc-tiers:researcher` e um gate no hook que impede delegar código sem
   pesquisa (ou sem dizer por que não precisa).
4. Benchmark de qualidade: % resolvido (FAIL_TO_PASS + PASS_TO_PASS), pass@1,
   pass^k, tokens por tarefa resolvida e Δ% contra o Claude Code puro. Uma
   vitrine (calculadora) ao lado da suíte difícil.

## Não-metas

- Não muda a ordem de escalada (Haiku → Sonnet → Opus) nem o contador.
- Não remove o Haiku, o budget routing, o light mode nem a integração com cc-cost.
- Não apaga resultados antigos em `bench/results/` (ficam como histórico; o
  README deixa de citá-los).
- **Não roda o benchmark completo** nesta entrega. Rodar gasta a janela do
  usuário e é decisão dele depois.

## Anti-metas (seria fracasso mesmo funcionando)

- Pesquisa que trava tarefa trivial (typo, rename) ou vira parede de texto.
- Resumo de pesquisa com "fato" sem fonte, ou que chuta quando não achou.
- README afirmando ganho de qualidade sem número medido.
- Gate de pesquisa que dá para burlar só escrevendo `done`.

## Restrições

- Node 18+, sem dependências novas; Claude Code 2.1.295+ (README já exige).
- Hooks continuam em `hooks/cc_tiers.mjs` e seus pontos de entrada; testes em
  `tests/cc_tiers.test.mjs` (`npm test`); `claude plugin validate --strict .`
  continua passando.
- Estilo do repo: inglês nos arquivos do plugin, frases curtas e concretas,
  comentários raros. README pt-BR acompanha o EN.
- Commits: só com ordem do usuário (regra do usuário, fora de fluxo de issue).

## Parte A — Posicionamento e padrões

**Slogan:** "Opus plans and reviews. Sonnet builds. Research comes first." A
primeira frase do README passa a ser sobre qualidade: separar planejamento,
pesquisa, implementação e revisão independente em contextos diferentes, com
escalada levando as notas de falha.

**Padrões que mudam** (decididos por mim, o usuário delegou):

| Chave | Antes | Agora | Motivo |
| --- | --- | --- | --- |
| `review_policy` | `cheap` | `risky` | Opus revisa todo trabalho não trivial. É o maior ganho de qualidade disponível. |
| `show_cost` | `on` | `off` | Dólar de API não é o que o assinante paga. A opção continua existindo. |
| `research` (nova) | — | `on` | Parte B. |
| ladder `effort.sonnet` | `medium, high, xhigh` | `high, xhigh` | Sonnet começa pensando mais; o 3º degrau some porque 2 falhas já escalam. `implementer.md` passa a `effort: high`. |

**O que fica e só muda de texto:**
- Budget routing vira "proteger sua janela do Pro/Max", não corte de dólar.
- Light mode vira "quando a janela aperta". O orquestrador Opus é o modo
  principal. O texto "light mode is the setting that saves" sai.
- `cc-tiers cost` continua disponível com `show_cost: on`. O README descreve
  como opcional.

## Parte B — Pesquisa antes de supor

### Agente `agents/researcher.md`

- `model: sonnet`, `effort: medium`, `maxTurns: 25`, `color` livre.
- Ferramentas: `Read, Grep, Glob, Bash, WebSearch, WebFetch`. Não edita e não
  cria agentes (Bash só para ler: `cat` do lock, `ls vendor/`, `git log -S`).
- Entrada: o cabeçalho `CC_TIERS_TASK/TIER/ROLE: researcher` + a tarefa.
- O que faz, em ordem:
  1. **Versão:** lê o lock antes do manifesto (`composer.lock`,
     `package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`, `poetry.lock`/
     `uv.lock`/`requirements*.txt`, `go.sum`, `Cargo.lock`). Sem lock, o
     manifesto, e diz que é faixa.
  2. **Doc daquela versão:** README/CHANGELOG/`docs/` em `vendor/` ou
     `node_modules/`, docs versionadas oficiais, ou o repositório na tag.
     Nunca a doc da `main` quando a versão diverge, e diz quando só achou a
     da `main`.
  3. **No repo:** onde o projeto já faz algo parecido (arquivo:linha). Reusar
     antes de criar.
  4. **Quem já resolveu:** issue, guia oficial, exemplo da lib, post técnico
     confiável. Extrai a ideia e diz o que muda para este projeto, **só se
     aplicável**. Senão, "nada aplicável".
- Saída: um resumo de até ~30 linhas com três blocos (**Versão e doc**, **No
  repo**, **Fora do repo**), cada fato com fonte (caminho ou URL). O que não
  achou aparece como "não encontrado", nunca como suposição. Fecha com o
  trailer `CC_TIERS_TASK/TIER: sonnet/ROLE: researcher/STATUS: pass|fail/REASON`.
- O researcher **não é uma tentativa**: o hook trata o relatório dele como o do
  planner (não conta falha, o gasto vai para o slug). `STATUS: fail` só
  significa "não consegui pesquisar".

### Gate no hook (`checkDelegation`)

Com `research` ligado, delegar a um **escritor que não seja trivial**
(`cc-tiers:implementer`, `cc-tiers:architect`) exige no prompt uma linha:

- `CC_TIERS_RESEARCH: done` — só aceita se um `cc-tiers:researcher` já
  **terminou** para aquele slug nesta sessão (o hook marca isso no estado da
  tarefa quando processa o relatório do researcher). Sem isso, recusa com a
  mensagem "rode cc-tiers:researcher para <slug> antes".
- `CC_TIERS_RESEARCH: none - <motivo>` — aceita sem pesquisa (tarefa sem
  dependência externa, por exemplo). Motivo vazio é recusado.

O `cc-tiers:worker` (Haiku, trivial) é isento. Retentativas e escaladas do mesmo
slug reaproveitam a pesquisa. O orquestrador cola o resumo do researcher no
prompt do escritor, logo abaixo do cabeçalho.

Detalhes do gate (decididos depois da revisão do design):

- **Só `STATUS: pass` conta.** Um researcher com `fail` não libera `done`; o
  orquestrador pesquisa de novo ou usa `none - <motivo>`.
- **A marca vive fora do estado da tarefa.** Ela fica num registro próprio por
  sessão (`researched`: slug → true), que não some quando a tarefa passa e é
  apagada do estado. Uma pesquisa pode cobrir vários slugs: o prompt do
  researcher aceita `CC_TIERS_COVERS: <slug>, <slug>`, e o hook marca todos
  quando ele termina com pass.
- **Tarefa que começou no worker** e subiu para o implementer (por escalada ou
  pelo classificador) passa pelo gate na primeira delegação ao implementer:
  pesquisa nessa hora ou `none - <motivo>`.
- **O resumo não conta como sinal de roteamento.** Ele vai entre
  `CC_TIERS_RESEARCH_BEGIN` e `CC_TIERS_RESEARCH_END`. O hook retira esse bloco
  antes de `isRisky`, `assessComplexity`, `decideTier` e do histórico de falhas,
  para que palavras de URL ou de doc não subam o effort nem poluam
  `.claude/cc-tiers-history.json`.
- **Em budget conserve, o gate continua ligado.** Qualidade é o objetivo, e o
  conserve já tira o Opus do trabalho novo. O researcher roda no Sonnet. Quem
  quiser poupar janela desliga com `research: off`.

O teto do Opus (o orquestrador implementando sem Agent call) e o dispatcher
fazendo a tarefa sozinho não passam pelo PreToolUse, então não têm gate. Para
eles a regra vale pelo prompt: chamar o researcher (ou pesquisar no próprio
contexto) antes da primeira edição.

### Mudanças de prompt

- `orchestrator.md` e `dispatcher.md`: um passo "Research" antes de delegar
  código. Pesquisas de tarefas independentes podem rodar em paralelo. O
  researcher entra na tabela "Who does the work".
- `implementer.md` e `architect.md`: o resumo de pesquisa é fato. Se faltar um
  fato sobre uma API, conferir no lock e na doc da versão antes de usar. Nunca
  supor assinatura.
- `reviewer.md` e `checker.md`: conferir que o código usa a API da versão que o
  resumo aponta.
- `skills/tiers/SKILL.md`: incluir o passo.

### Configuração

- `plugin.json`: opção `research` (`on`/`off`, padrão `on`).
- `config/routing.default.json`: `"research": true`. O project file aceita
  `research`, e o `/config` vence, como as outras chaves.
- Resumo da sessão (`formatSessionContext`): uma linha "Research: on/off".
- `bench/run.mjs` não precisa mudar por causa disso.

## Parte C — Benchmark de qualidade

### Métricas (por configuração)

- **Resolvido** (estilo SWE-bench): uma execução resolve a tarefa quando os
  testes FAIL_TO_PASS **e** os PASS_TO_PASS passam.
  - **FAIL_TO_PASS:** o check escondido da tarefa (`checks*/<id>.test.mjs`).
  - **PASS_TO_PASS:** os arquivos de teste que **passavam antes do passo**,
    rodados de novo depois, na forma de antes (o runner guarda uma cópia
    deles antes de chamar o modelo, então o modelo não "conserta" o teste
    para passar). A regra é a mesma do SWE-bench e vale nos dois modos:
    - **one-shot:** "antes" é a fixture intacta;
    - **`--session`:** "antes" é a árvore como ficou depois da tarefa
      anterior. Assim uma mudança legítima de uma tarefa anterior (o `rename`
      de `sumMinutes`) não vira falsa regressão nas seguintes.
  - Cada tarefa pode listar em `changesTests` os arquivos de teste que ela
    legitimamente muda (ex.: `test/payroll.test.mjs` no `rename`). Esses saem
    do PASS_TO_PASS da tarefa. Na suíte difícil, a lista sai de quais testes
    as soluções de referência (`solutions-hard/`) tocam, e o `npm test`
    garante que os testes restantes passam com a solução de referência.
  - **Testes que o próprio modelo escreveu** não entram em "resolvido", como
    no SWE-bench. O runner registra se eles passam numa coluna à parte
    (informativa). A calibragem Sonnet antiga foi avaliada pelo critério
    anterior, e o README diz isso.
- **pass@1:** média de "resolvido" por execução (k repetições → média por
  tarefa → média das tarefas). É a manchete.
- **pass^k** (τ-bench): fração de tarefas resolvidas em **todas** as k
  repetições. Mede consistência.
- **Regressões:** execuções em que o FAIL_TO_PASS passou e o PASS_TO_PASS
  quebrou ("funcionou, mas quebrou outra coisa").
- **Tokens por tarefa resolvida:** tokens frescos (input + cache write +
  output, a mesma regra do cc-cost) somados ÷ execuções resolvidas. Mais
  **Δ% contra a linha de base**, que é `opus` (Claude Code puro no Opus, o
  padrão de quem tem Max).
- O JSON bruto continua guardando o `cost` em dólar que o Claude Code reporta,
  como dado. Ele não aparece nas tabelas.

### Tabelas (`--table` e a saída no fim da execução)

1. Uma linha por configuração: pass@1, pass^k, resolvidas/total, regressões,
   tokens por tarefa resolvida, Δ tokens vs Opus. Sem coluna de dólar.
2. Por tarefa: ✅/🟡/❌ e resolvidas/k em cada configuração.
3. Por tipo de tarefa (trivial/normal/hard/large): pass@1 por configuração.
4. A tabela de roteamento do cc-tiers continua como está.

### Vitrine: calculadora

- `bench/tasks-calc.json`, `bench/fixture-calc/` (projeto Node mínimo:
  `package.json` com `"type": "module"`, README de uma linha, `test/` com um
  teste trivial para o PASS_TO_PASS existir) e `bench/checks-calc/calc.test.mjs`.
- Um prompt curto e completo em requisitos: *"Create src/calc.js exporting
  evaluate(expression) that returns a number. Support + - * /, parentheses,
  unary minus, decimals and whitespace, with the usual precedence and
  left-to-right associativity. Division by zero throws a RangeError; any
  malformed input throws a SyntaxError. Do not use eval or Function. Add
  tests."*
- O check escondido cobre o que um "funciona no caso feliz" deixa passar:
  associatividade (`8-3-2`, `8/4/2`), parênteses aninhados, menos unário em
  todos os lugares (`-(2+3)`, `2*-3`, `--2`), decimais (`.5`, `1.25*4`),
  espaço em branco, `1/(2-2)`, entradas malformadas (`""`, `"2+"`, `"(1"`,
  `"1)"`, `"1 2"`, `"abc"`, `"1..2"`), e o código-fonte sem `eval(` nem
  `Function(`. `0.1+0.2` fica fora (o prompt não define arredondamento, e
  testar o que não foi pedido seria injusto).
- `npm test` ganha a mesma verificação das outras suítes: o check falha na
  fixture intacta e passa com uma solução de referência
  (`bench/solutions-calc/calc.js`).

### README

- Sai a tabela de dólar e o bloco "Light mode is the setting that saves".
- Entra a seção "Benchmark de qualidade": o que cada métrica mede (com o nome e
  a origem: HumanEval/pass@k, SWE-bench/FAIL_TO_PASS–PASS_TO_PASS,
  τ-bench/pass^k), como rodar (`npm run bench -- --tasks-file
  bench/tasks-calc.json --repeat 3` e a suíte difícil), e o aviso de que rodar
  com login Pro/Max gasta a janela.
- A tabela de resultados fica marcada como **não medida ainda**. Os números
  entram quando o usuário rodar. A calibragem Sonnet da suíte difícil continua
  citada, porque é dado real.

## Versão

0.6.0 em `plugin.json`, `package.json` e `CHANGELOG.md` (Added/Changed,
incluindo a mudança de padrões, que muda comportamento para quem atualizar).

## O que fica para quem constrói

- Texto exato dos prompts dos agentes e do README, no estilo atual.
- Nomes internos de funções e de campos no estado do hook.
- Como calcular e congelar a lista `passToPass` da suíte difícil (script único
  ou teste), desde que `npm test` prove que ela vale para a solução de
  referência.
- Os casos exatos do check da calculadora, dentro da lista acima.
- A ordem das etapas e o quebra em commits.

## Decisões minhas para o usuário conferir

- `review_policy` padrão `risky` (e não `always`).
- `show_cost` padrão `off`.
- Ladder do Sonnet começando em `high`.
- Researcher no Sonnet (não no Haiku).
- Gate obrigatório com saída `none - <motivo>`, e `done` só vale se o
  researcher rodou de verdade para o slug.
- Linha de base do Δ tokens = Opus puro.
- `0.1+0.2` fora do check da calculadora.
- Gate continua ligado em budget conserve.
- Uma pesquisa pode cobrir vários slugs (`CC_TIERS_COVERS`); researcher com
  `fail` não libera `done`.
- Resumo da pesquisa delimitado e fora dos sinais de roteamento e do histórico.
- PASS_TO_PASS = testes que passavam antes do passo, na forma de antes, menos
  `changesTests`; testes do próprio modelo ficam fora de "resolvido".
