# 🎚️ cc-tiers

### O Opus planeja, revisa e constrói o difícil. O Sonnet constrói o resto. O Haiku faz o simples.

Um plugin do Claude Code para assinantes Pro e Max que querem o trabalho certo da primeira vez. O ponto é o seu tempo e o código, não tokens. Você faz um pedido curto e não escreve a spec: o cc-tiers pesquisa o projeto e escreve os critérios de aceite sozinho. O código segue a documentação da versão instalada e as convenções do seu próprio projeto, reaproveita o que já existe e fica dentro da tarefa, sem você precisar pedir código limpo nem escrever regras para isso. Os hooks rodam os testes de novo antes de um pass valer, e uma revisão só conta com um defeito reproduzido, então você não precisa pedir de novo. Cada tarefa vai para o modelo de que precisa: Haiku para o simples, Sonnet para o trabalho normal, Opus para planejar, revisar, construir as tarefas difíceis (auth, pagamento, migration, concorrência, arquitetura) e pegar o que o Sonnet não terminou, para o Opus não ser gasto num typo. No relógio, uma execução demora mais que o Opus sozinho.

[![Claude Code](https://img.shields.io/badge/Claude_Code-2.1.295%2B-d97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://claude.com/claude-code)
[![Plugin](https://img.shields.io/badge/tipo-plugin-8a63d2?style=for-the-badge)](#-instala%C3%A7%C3%A3o)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-2f81f7?style=for-the-badge)](LICENSE)

[English](README.md) · **Português**

🔬 pesquisa antes do código  •  🧐 revisão independente  •  🪜 mais effort antes de um modelo maior  •  🔁 duas falhas, depois sobe  •  📏 qualidade medida  •  ✅ testes rodados de novo pelo hook  •  ♻️ reaproveitar antes de escrever

---

## 🚀 Instalação

No prompt de uma sessão do Claude Code, quando este repositório for o marketplace `edsoncantuaria/cc-tiers`:

```
/plugin install cc-tiers --marketplace edsoncantuaria/cc-tiers
```

> [!TIP]
> Responda `y` para adicionar o marketplace e escolha o escopo. A sessão seguinte começa no orquestrador Opus — nada mais para instalar.

Para experimentar um checkout local sem publicar:

```bash
git clone https://github.com/edsoncantuaria/cc-tiers
claude --plugin-dir /caminho/para/cc-tiers
```

---

## 🔎 Quem faz o quê

| Nível | Agente | Modelo | Faz |
| :-: | --- | --- | --- |
| Plano | `cc-tiers:orchestrator` | Opus | Divide o pedido, delega e implementa as tarefas difíceis e o teto |
| Pesquisa | `cc-tiers:researcher` | Sonnet | Acha a versão instalada, a documentação dessa versão, o uso existente, o código reaproveitável e as convenções antes de o código ser escrito. Não edita |
| Padrão | `cc-tiers:implementer` | Sonnet | Features, bugs, testes, refactors locais |
| Miúdo | `cc-tiers:worker` | Haiku | Renomear, typos, formatação, buscas simples, edições de ~15 linhas |
| Checagem | `cc-tiers:checker` | Sonnet | Uma passada nova sobre a saída do Haiku. Não edita |
| Revisão | `cc-tiers:reviewer` | Opus | Uma passada nova sobre trabalho arriscado ou não trivial. Não edita |
| Modo leve | `cc-tiers:dispatcher` | Sonnet | Agente de sessão opcional para quando a janela está apertada: encaminha no Sonnet e só chama o Opus quando precisa |
| Plano leve | `cc-tiers:planner` | Opus | Planeja um pedido com várias tarefas para o dispatcher. Não edita |
| Teto leve | `cc-tiers:architect` | Opus | Implementa as tarefas difíceis e o teto para o dispatcher |

Com o plugin ativo, o `settings.json` define o agente da sessão como `orchestrator`. O seu `agent` em `~/.claude/settings.json` continua valendo. Se você substituir, `/cc-tiers:tiers` roda o mesmo fluxo.

Os agentes fixam `model: haiku`, `sonnet` ou `opus`. O orquestrador não passa modelo na chamada, porque um override por chamada trocaria o nível. Um hook PreToolUse recusa a delegação do cc-tiers que tentar.

```mermaid
flowchart LR
    A[Orquestrador Opus] --> B{Tarefa}
    B -- miúda --> C[Worker Haiku]
    B -- normal ou difícil --> R[Researcher Sonnet]
    R -- briefing --> D[Implementer Sonnet]
    R -- briefing, difícil --> E
    C -- falha duas vezes --> D
    D -- falha duas vezes --> E[Opus implementa]
    C -- passa --> V{Gate de verificação}
    D -- passa --> V
    E -- passa --> V
    V -- comando falha --> C
    V -- comando falha --> D
    V -- verificado --> H[Checker Sonnet]
    V -- verificado, arriscada --> F[Revisor Opus]
    H -- rejeita --> C
    F -- rejeita --> D
    H -- aprova --> G[Pronto]
    F -- aprova --> G
```

---

## 🔬 Pesquisa primeiro

Código escrito de memória, com uma versão antiga da API em mente, falha de jeitos que o teste nem sempre pega. Antes de uma tarefa ir para o `cc-tiers:implementer` ou o `cc-tiers:architect`, o `cc-tiers:researcher` (Sonnet, só leitura) confere estas coisas:

- A versão em uso, lida primeiro no arquivo de lock e depois no manifesto.
- A documentação dessa versão, vinda de `vendor/` ou `node_modules/` quando instalada, nunca a da última release por padrão.
- Como a documentação dessa versão recomenda fazer a tarefa e o que ela marca como obsoleto.
- Como o repositório já chama a API, como `arquivo:linha`.
- Reuso: código que o repositório já tem e que faz tudo ou parte da tarefa, como `arquivo:linha`.
- Convenções: um ou dois trechos próximos a seguir (nomes, tratamento de erro, estilo de teste, quantidade de comentário).
- Referências fora do repositório, só quando se aplicam.

Ele devolve um briefing de até umas 40 linhas em três blocos, **Versão e doc**, **No repo** (uso, Reuso, Convenções) e **Fora do repo**, com a fonte de cada fato. O orquestrador cola o relatório inteiro, trailer incluído, no prompt de quem vai escrever, entre duas linhas que só têm `CC_TIERS_RESEARCH_BEGIN` e `CC_TIERS_RESEARCH_END`, e acrescenta `CC_TIERS_RESEARCH: done`. Uma tarefa que não toca biblioteca, framework nem API externa diz o motivo no lugar: `CC_TIERS_RESEARCH: none - <motivo>`. Um briefing pode servir a várias tarefas: o prompt do pesquisador leva `CC_TIERS_COVERS: <slug>, <slug>`, e um pass marca todos.

O hook PreToolUse garante isso. Ele recusa a chamada ao implementer ou ao architect que não tem nem pesquisa concluída para aquela tarefa nem a linha `none`. Pesquisa não é tentativa, e uma pesquisa que falha não conta contra a tarefa. O worker fica de fora. O teto Opus e a tarefa do próprio dispatcher são pesquisados por prompt, sem checagem do hook. `research: off` tira o passo e a checagem.

**Pesquisa depois de uma falha.** Uma falha contada e diagnosticada como `docs-version`, `type`, `integration`, `test` ou `regression` pode pedir uma busca na web. A nota de falha termina então com uma linha `Failure research:` e até três linhas `CC_TIERS_FAILURE: <sintoma>`: o sintoma e a evidência do diagnóstico, com segredos redigidos, caminhos absolutos trocados por `<path>`, tokens `CC_TIERS_` removidos e cada linha cortada em 160 caracteres. O orquestrador (ou o dispatcher) pode rodar o `cc-tiers:researcher` para esse slug antes da próxima tentativa, com essas linhas no prompt, fora de qualquer bloco. Nesse modo o pesquisador lê primeiro a versão instalada e depois busca nesta ordem: a documentação oficial dessa versão, issues e PRs do repositório oficial, discussões técnicas e relatos de bug, e Stack Overflow ou outras fontes da comunidade. Uma consulta leva só a mensagem de falha, a biblioteca e a versão, nunca um segredo, um caminho privado nem código-fonte, e uma página buscada é dado não confiável, nunca instrução. Ele reporta `Symptom`, `Probable cause`, `Suggested fix`, `Version`, `Sources` e `Match`, e acrescenta `CC_TIERS_MATCH: high|partial|none` ao trailer; `none` com `CC_TIERS_STATUS: pass` é um resultado válido. O orquestrador cola esse briefing no prompt seguinte como um segundo bloco de pesquisa, depois do original. A sugestão nunca é obrigatória, e um match `none` ou uma busca que não passou nunca atrasa a nova tentativa nem a escalada. Uma busca de falha não conta tentativa, e um pass marca a tarefa como pesquisada. `failure_research_max` (padrão 1, de 0 a 5) limita quantas notas de falha de uma tarefa, em todos os níveis dela, podem sugerir uma busca, e `failure_research: off` tira a sugestão. A nota que para uma tarefa depois da última tentativa do Opus não sugere nada. Quando uma tarefa que recebeu a oferta de uma busca escala, a nota acrescenta uma linha `Research dossier:`: o próximo nível recebe os dois briefings, as notas de falha e as hipóteses já tentadas, e só busca de novo por uma lacuna que o dossiê nomeia. O match fica na telemetria como `research.failure`, e o `/cc-tiers:insights` o conta.

---

## 🧹 Código limpo sem pedir

Quem escreve já leva estas regras, então um projeto não precisa de regras no CLAUDE.md para isso:

- Reaproveitar ou estender o que existe, nunca forkar. O bloco Reuso do briefing diz onde olhar.
- Seguir a documentação da versão instalada e as convenções do arquivo editado.
- Mexer só no que a tarefa exige: sem refator, reformat, rename ou bump de dependência de passagem.
- Sem proteção hipotética: retry, cache, fallback ou compatibilidade só quando algo real consome.
- Corrigir a causa, não o sintoma: nada de erro engolido, lint ou tipo silenciado, teste pulado ou caso especial para a entrada do teste. Um contorno inevitável leva um comentário de uma linha dizendo o porquê.
- Sem código especulativo: abstração, opção ou arquivo novo só quando a tarefa ou um segundo chamador real precisa; sem checagem de estado impossível, sem log de debug esquecido.
- Comentário só para o que o código não consegue dizer.
- Parar quando estiver verificado. Sem passes extras.

O revisor bloqueia código que recria o que o projeto já tem e mudanças fora da tarefa (ambos achados de `scope`). Também bloqueia mudança que esconde uma falha em vez de corrigir a causa, sem comentário dizendo o porquê (`correctness`), e arquivo novo de que a tarefa não precisa (`scope`). Proteção hipotética, código especulativo, log de debug esquecido, estilo, ruído de comentário e gosto de nome são notas: vão para o relatório final e nunca reprovam uma tarefa.

---

## 📝 Especificar e perguntar

A pesquisa diz o que é verdade; os critérios dizem o que é pronto. Antes de uma tarefa que escreve código ir para o `cc-tiers:implementer` ou o `cc-tiers:architect`, o orquestrador (ou o dispatcher) escreve ele mesmo os critérios de aceite, a partir do pedido e da pesquisa, para você não precisar. O fluxo é pesquisar, especificar, perguntar (só se preciso), implementar, revisar.

Os critérios vão no prompt da delegação, entre duas linhas que só têm `CC_TIERS_SPEC_BEGIN` e `CC_TIERS_SPEC_END`, em até umas 15 linhas:

- `Criteria:` resultados observáveis.
- `Edge cases:` entradas ou estados que podem quebrar.
- `Assumed:` (só quando preciso) o que foi escolhido onde o pedido ficou em silêncio.

Cada linha diz de onde veio: `(request)`, `(repo: arquivo:linha)`, `(docs: <link ou caminho>)`, `(decided: <motivo>)`, ou `(user)` para uma resposta. O mesmo bloco vai para o implementer e para o reviewer ou checker daquela tarefa. O implementer constrói e testa cada linha, e o reviewer rejeita um critério ou caso de borda não atendido ou sem teste. Uma nova tentativa ou uma escalação reaproveita o bloco.

**Quando pergunta.** Só quando duas leituras razoáveis levam a código diferente e nem o projeto nem a documentação da versão em uso decidem. O resto ele decide e marca `(decided: ...)`. Pergunta uma vez, antes de implementar, todas as perguntas juntas, no máximo 3, com `AskUserQuestion` de múltipla escolha e a opção recomendada primeiro, com o motivo. Sua resposta entra no bloco como `(user)`.

**Quando ninguém pode responder.** Se o `AskUserQuestion` não estiver disponível ou for negado, ele segue com a opção recomendada, registra em `Assumed:`, diz isso no relatório final e não espera.

**Código novo é alcançável.** Para um módulo, componente, handler ou job novo, um critério diz como o código novo é chamado (uma rota, uma cadeia de imports, uma chamada de inicialização). Código novo que nada chama não atende o pedido, e o revisor o reporta como achado `correctness` bloqueante.

**Reproduzir antes de corrigir.** Para um bug que dá para reproduzir em código, os critérios trazem uma seção `Repro:` com o comando que o reproduz, por exemplo ``- `node --test tests/x.test.mjs` fails before the fix with <mensagem> (request)``. Uma falha de infraestrutura, de ambiente ou flaky e um bug que não dá para reproduzir não têm `Repro:`: essa correção é validada por outros meios, na proporção do risco, e um teste novo só é exigido quando é viável e relevante. Quem escreve (o worker, o implementer, o architect, o teto Opus, a tarefa do próprio dispatcher) escreve ou encontra esse teste primeiro e o roda antes de mudar qualquer código, e depois reporta como ele falhou, antes das linhas de critério: ``CC_TIERS_REPRO: `<comando>` - <falha antes da correção>``. Faz a menor correção possível, roda o mesmo comando de novo e o lista em `CC_TIERS_VERIFY`. Nunca enfraquece, pula nem apaga o teste que reproduz para fazê-lo passar. Quando o bug não dá para reproduzir, reporta `CC_TIERS_REPRO: none - <motivo>`. Numa nova tentativa ou numa escalada a correção já pode estar na árvore, então quem escreve repete a linha `CC_TIERS_REPRO` anterior das notas de falha em vez de reportar uma falha nova. O mesmo bloco, `Repro:` incluído, vai para a revisão. Veja Contrato do spec e conclusão para saber como o hook o julga.

**Aprovação dos critérios.** `contract_approval` (padrão `critical`; `high` ou `off`) diz quais tarefas precisam do seu OK nos critérios antes. Antes da primeira delegação de uma tarefa nesse risco ou acima, o orquestrador mostra os critérios, pergunta uma vez com `AskUserQuestion`, opção recomendada primeiro, e então acrescenta `CC_TIERS_APPROVED: user - <como>` à delegação. Quando nenhum humano pode responder, ele acrescenta `CC_TIERS_APPROVED: none - <motivo>` e diz isso no relatório final; a tarefa então termina com confiança moderate no máximo, com o motivo `criteria not approved by the user`. O hook PreToolUse recusa a chamada ao worker, ao implementer ou ao architect que tem critérios, risco igual ou acima da opção e nenhuma das duas linhas, até o contrato da tarefa ter uma aprovação. Uma nova tentativa não precisa de linha nova, mas um `CC_TIERS_RESPEC` que acrescenta, tira ou reescreve um critério anula a aprovação e pergunta de novo. `off` não pergunta nada.

Uma tarefa que não precisa de critérios (edição mecânica, consulta) diz o motivo com `CC_TIERS_SPEC: none - <motivo>`. O caminho leve e o worker pulam este passo. O hook PreToolUse recusa a chamada ao implementer ou ao architect que não tem nem um bloco com conteúdo nem a linha `none`, e ignora uma linha `CC_TIERS_*` dentro do bloco. `specify: off` tira o passo e a checagem.

---

## ✅ Verificar

Um `pass` era a palavra do agente. Com o gate, o hook roda a checagem ele mesmo. Todo relatório de quem escreve (worker, implementer, architect, o teto Opus, a tarefa do próprio dispatcher) lista os comandos que provam o trabalho, um por linha, antes do status:

```
CC_TIERS_VERIFY: node --test test/booking.test.mjs
CC_TIERS_VERIFY: npx tsc --noEmit
CC_TIERS_STATUS: pass
```

Quando nada verifica a mudança (gravar no aparelho, tela conferida à mão), o relatório diz isso: `CC_TIERS_VERIFY: none - <motivo>`. O comando é o focado na área tocada, o mesmo que quem escreveu rodou, não o projeto inteiro.

**O que o hook roda.** Só quando o relatório é `pass`. Ele roda cada comando como argv, sem shell, no diretório do projeto. Uma linha com qualquer um de `` ; | & > < ` $ ( ) `` ou quebra de linha é recusada, e no Windows também `% ! ^`. Também é recusada a linha que traz código em vez de apontar um teste do repositório: uma URL `data:` ou `javascript:` em qualquer lugar, ou, depois do programa, uma flag que carrega ou avalia código (`--import`, `--require`, `-r`, `--loader`, `--experimental-loader`, `-e`, `--eval`, `-p`, `--print`, `--script-shell`, `--node-options`, `--userconfig`, `--globalconfig`, também abreviada, porque o npm expande, e na forma `--flag=valor`). Isso recusa `node -p` e `pytest -p` também. Duas formas o próprio hook interpreta: `KEY=valor` no começo vira variável de ambiente (`APP_ENV=testing vendor/bin/phpunit`), e `cd <dir> && <comando>` roda em `<dir>`, que tem de ser relativo e ficar dentro do projeto, com symlinks resolvidos. Chaves que mudam qual programa roda ou carregam código antes são recusadas, em maiúscula ou minúscula: `PATH`, `PATHEXT`, `LD_*`, `DYLD_*`, `NODE_OPTIONS`, `NODE_PATH`, `npm_config_*`, `PYTHONPATH`, `PYTHONSTARTUP`, `PYTHONHOME`, `BASH_ENV`, `ENV`, `PERL5OPT`, `PERL5LIB`, `RUBYOPT`, `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `PHPRC`, `PHP_INI_SCAN_DIR`. A lista de prefixos é conferida no que sobra.

**Lista de prefixos.** `verify_allow` é uma lista de prefixos separados por vírgula, comparados por palavras inteiras: `npm test` casa `npm test -- x`, não `npm testx`. O padrão cobre `npm test`, `node --test`, `npx tsc`, `npx eslint`, `npx vitest`, `npx jest`, `npx playwright test`, PHPUnit, PHPStan, PHPCS, `pytest`, `go test` e `cargo test`. O gate também roda, sem entrada, um comando que é exatamente uma das checagens que o cc-tiers detectou no projeto (as que o bloco de contexto de quem escreve lista, como `npm test` quando o `package.json` tem um script `test`): vale o comando inteiro, não um prefixo. Uma linha `docker exec`, `docker compose exec` ou `docker-compose exec` é julgada pelo comando que roda dentro do container, então, quando a lista ou as checagens detectadas cobrem esse comando, o wrapper não precisa de entrada: `docker exec app vendor/bin/phpunit` roda com a lista padrão. Antes do nome do container o gate aceita só `-i`, `-t`, `-w` e `-u` no `docker exec`, e `-T`, `-w`, `-u` e `--index` no compose; qualquer outra opção (`-e`, `--env-file`, `--privileged`, `-d`) volta a tratar a linha como um comando comum, recusada a menos que a lista a cubra. Com um `KEY=valor` antes dela, o gate não olha dentro do container, porque `DOCKER_HOST`, `DOCKER_CONFIG` e parecidas escolhem o que o docker roda: essa linha só roda se o `verify_allow` cobrir o próprio comando docker. O próprio `docker exec` não está no padrão: uma entrada para ele liberaria qualquer comando dentro do container. Um valor de `verify_allow` substitui a lista padrão, então acrescente a entrada que o seu projeto precisa, como `make check`, depois das que já estão lá. A lista restringe a forma do comando, não o que um teste executa: teste é código do repositório, e o agente já pode escrever código.

**Resultados.**

- Um comando que sai com código diferente de zero roda mais uma vez. Passar na segunda é pass, informado como `flaky`. Falhar duas vezes é falha, e a nota da próxima tentativa leva o comando, o código de saída e as últimas 40 linhas da saída. Quando o orçamento não deixa tempo para a segunda rodada, ou a corta no meio, vale a primeira falha.
- Um comando que estoura o `verify_timeout` (padrão 300 s) conta como falha: teste que trava é defeito ou ambiente quebrado, e nos dois casos o pass não vale.
- `verify_budget` (padrão 600 s) limita o relatório inteiro, segundas tentativas incluídas. No Stop ele limita todos os passes estacionados juntos, para caberem no timeout do hook. Os comandos depois dele não rodam e entram como não validados. Isso não é falha, então uma suíte lenta não empurra a tarefa para o Opus.
- Uma falha interrompe os comandos que vêm depois.
- Um comando fora da lista, uma linha `none` ou uma linha recusada fica **não validado**: nada roda e não é falha. A mensagem diz qual prefixo acrescentar ao `verify_allow` em `/config` (numa linha com wrapper, o comando de dentro do container), mantendo as entradas que já estão lá.
- Um comando que não consegue nem começar (o programa não está instalado, o arquivo não existe) também fica **não validado**: `could not start: <comando>`. Nada rodou, então não diz nada sobre o código e não é falha.
- Um comando que já passou na mesma árvore (mesmo `HEAD`, mesmo conteúdo em cada arquivo alterado) não roda de novo: o relatório diz `reused for the same tree`. O gate que roda no Stop, para o teto Opus e o dispatcher, reusa um pass do mesmo jeito. Um pass que foi `flaky` nunca é reusado: roda de novo e mantém o rótulo `flaky`.
- Um comando que sai com zero mas cria, apaga ou muda um arquivo que o git rastreia ou não ignora fica **não validado**: `changed the tree: <caminhos>`. Ele não pode valer como evidência, porque a árvore que ele provou não é a que ele deixou. O hook compara o `git status` e os hashes de conteúdo antes e depois de cada comando. Fora de um repositório git, ou num pass reaproveitado, nada é comparado.
- Enquanto outro escritor não isolado roda na mesma árvore, essa checagem é pulada, porque as edições dele não são do comando. O gate diz `tree check skipped: <tarefa> still writing`, e o comando conta como antes.
- Um `pass` sem nenhuma linha `CC_TIERS_VERIFY` conta como falha.

**Uma falha que já existia.** Quando o único comando que falha falha do mesmo jeito sem a mudança de quem escreveu, o relatório pode dizer isso com `CC_TIERS_PREEXISTING: <comando> - <evidência de que falha sem a mudança>`, antes de `CC_TIERS_STATUS: pass`, e manter esse comando nas linhas `CC_TIERS_VERIFY`. Quem escreve mostra isso numa cópia de trabalho do `HEAD` fora do repositório, nunca na árvore compartilhada. Uma vez por tarefa, e a menos que `review_policy` seja `never`, o hook não conta a falha do gate de exatamente esse comando quando todos os outros comandos rodaram e passaram; qualquer outro comando que falha conta como sempre. A tarefa vai para o `cc-tiers:reviewer` (Opus), que precisa confirmar que o comando falha numa cópia da base sem a mudança, e rejeita quando não confirma. Só o revisor Opus pode confirmar: uma chamada ao `cc-tiers:checker` para essa tarefa é recusada, e um pass do checker não a termina. A linha de conclusão fica `partial` no máximo, com as contagens reais das checagens.

O relatório final diz, por tarefa, `verified: <comandos>`, `flaky: <comando>` ou `not validated: <motivo>`, e o `/cc-tiers:report` tem uma coluna Verify para isso. O gate roda onde o relatório é contado. O teto Opus e o dispatcher não têm chamada Agent, então o pass espera até o hook Stop, que roda os comandos fora do lock da sessão. O pass fica estacionado até ser contado, então um Stop interrompido no meio do gate o deixa para o próximo. Um reprovado bloqueia o Stop uma vez com a nota. O caminho leve (tarefa trivial feita inline) fica fora do gate; o caminho pequeno inline fica dentro, porque usa o trailer de tentativa. `verify: off` tira o gate.

**Limites.** O gate prova que o comando declarado passa, não que ele cobre a mudança: quem escreve pode declarar um teste que não toca o que mudou, e a revisão é quem pega isso. Sessões paralelas no mesmo checkout podem fazer um comando falhar por causa de outra tarefa; a mensagem de falha diz isso quando há outra tarefa ativa. Os comandos rodam pelo hook, não pelas suas regras de permissão, e é por isso que a lista existe. Um timeout mata o comando com SIGKILL; processos que ele deixou rodando em segundo plano podem sobreviver.

---

## 🧾 Revisão com evidência

Uma revisão rejeitava com "uma razão concreta", e isso pesava igual com prova ou sem. Agora uma rejeição só conta quando traz um defeito bloqueante com um jeito de reproduzir. O revisor recebe o diff, o bloco de spec, o bloco de pesquisa e o pedido, e nunca o relatório nem a explicação de quem escreveu: um revisor que lê o raciocínio do autor herda os pontos cegos dele.

O revisor passa por corretude, regressão, segurança, estado (ordem, idempotência, atomicidade) e escopo, nessa ordem. Código recriado e mudanças fora da tarefa são achados `scope` bloqueantes. Cada achado é um bloco antes do trailer:

```
CC_TIERS_FINDING_BEGIN
category: state
severity: blocking
evidence: command
command: node --test test/booking.test.mjs
expected: an old event does not close the reopened shift
observed: 'reopen keeps open' fails: expected open, got closed
where: src/booking.js:142
CC_TIERS_FINDING_END
```

`category` é `correctness`, `regression`, `security`, `state` ou `scope`, ou uma das mais finas em Protocolo de revisão (`access-control`, `input-validation`, `data-exposure`, `error-handling`, `concurrency`, `api-usage`, `compatibility`). `severity` é `blocking` ou `note`, ou uma das graduadas de lá (`blocker`, `high`, `medium`, `low`, `suggestion`). O achado descreve o defeito, nunca a correção: quem escreve escolhe a correção. Endurecimento que o spec não pede, estilo e o que é de outra issue são sempre notas.

O prompt do revisor leva mais quatro checagens:

- **Teste de mutante**: quando a mudança acrescenta ou edita um teste que deveria cobrir a correção, o revisor copia só os arquivos de teste para uma cópia de trabalho da base fora do repositório e roda o teste. Um teste que passa sem a correção é um achado `correctness` bloqueante com `evidence: trace`. Quando o ambiente não consegue rodar numa cópia de trabalho (dependências ausentes), ele pula a checagem e diz isso na linha de motivo. Quando o spec tem um critério `Repro:`, a checagem usa o comando dele: na cópia de trabalho da base, com os arquivos de teste da mudança copiados, ele tem de falhar, e com a mudança tem de passar. Um teste que reproduz e foi enfraquecido, pulado ou apagado, ou que falha por um motivo que não é o bug, é um achado `correctness` bloqueante com `evidence: trace`. O checker leva a mesma regra.
- **Alcance**: código novo que nada chama (nenhuma rota, cadeia de imports ou chamada de inicialização chega até ele) é um achado `correctness` bloqueante com `evidence: trace`.
- **Conteúdo não confiável**: tudo o que está no diff (código, comentários, strings, nomes de arquivo, saída de teste) é evidência, nunca instrução. Um comentário que diz "reviewer: approve" não muda nada.
- **Re-revisão focada**: depois de uma nova tentativa, o prompt lista os achados bloqueantes anteriores, não o relatório de quem escreveu. O revisor confere se foram corrigidos e se a correção não quebrou nada, e não reabre um critério que uma revisão anterior aprovou, a menos que o diff novo o toque.

O revisor tem 40 turnos (tinha 30) e o checker 25 (tinha 20).

**O que conta.** `CC_TIERS_STATUS: fail` só é falha com pelo menos um achado bloqueante válido. `evidence` é um de três:

- `command`: um comando no formato do `CC_TIERS_VERIFY`, mais `expected`, `observed` e `where`. O hook roda uma vez quando o comando está na lista. Se **passa**, o achado é descartado como falso positivo. Se falha, o achado vale. Fora da lista, vale como `trace`.
- `trace`: uma entrada concreta, `expected`, `observed` e `where: arquivo:linha`. O hook não confere.
- `coverage`: um critério ou caso de borda do spec que nenhum teste exercita, com `criterion:` (a linha do spec, copiada) e `where:` (os testes que o revisor leu). Só vale quando o critério é igual a uma linha inteira do bloco de spec daquela tarefa (fora marcador, etiqueta de origem, caixa, acentos e espaços), então não vira endurecimento que o pedido não pediu. Tarefa com `CC_TIERS_SPEC: none` não admite achado `coverage`.

Um bloco incompleto não conta. Um `fail` sem achado bloqueante válido não é falha: a mensagem diz `rejected without evidence; <n> finding(s) became notes` e a tarefa é tratada como aprovada. As notas vão para o relatório final como lista, e a nota enviada a quem escreve numa falha de verdade leva só os achados bloqueantes. O revisor não edita arquivos; pode rodar comandos de leitura e testes que já existem, e não acrescenta testes ao repositório.

**Um relatório sem veredito.** Um relatório do revisor ou do checker sem linha `CC_TIERS_STATUS` não é um pass. Quando traz um achado bloqueante que se sustenta, conta como falha do nível que escreveu o diff, e a mensagem diz que a revisão não teve linha `CC_TIERS_STATUS` mas teve achados bloqueantes. Sem um achado assim, não conta nada: a tarefa fica em revisão e a nota manda o orquestrador pedir o veredito ao mesmo revisor com `SendMessage` (ou rodar a revisão de novo). O revisor continua registrado (50 agentes no máximo, os mais antigos saem primeiro), então a próxima parada dele é contada, tenha ele rodado em primeiro plano ou em background, e uma resposta sem status pergunta de novo. O status de uma revisão é lido só do relatório dela: uma linha de status no prompt, como um trailer anterior colado, é ignorada.

**Uma rejeição pertence a uma tentativa.** Ela fica presa à tentativa de quem escreveu que a revisão julgou. Um pass de outra revisão dessa tentativa não a limpa nem termina a tarefa, e uma nova rejeição da mesma tentativa acrescenta os achados, mas não uma segunda falha. Uma tarefa que parou no teto Opus continua parada. O próximo relatório de quem escreve limpa a marca, porque é uma tentativa nova, exceto o pass da própria sessão que esperava o gate do Stop enquanto a revisão o rejeitava: essa é a tentativa julgada, então a rejeição continua. Limite: uma fatia lançada antes do próximo relatório de quem escreve que chega depois dele é cobrada da tentativa nova.

**Um diff grande.** Quando a última tentativa de quem escreve mudou mais de 15 arquivos, uma revisão só pode ficar sem turnos, então a delegação da revisão ganha uma nota para revisar em fatias: um `cc-tiers:reviewer` por grupo de arquivos relacionados, mais uma revisão de integração sobre o diff inteiro, cada uma com o bloco de spec. Uma chamada que já é uma dessas fatias segue em frente.

`review_evidence: off` volta à 0.6: qualquer `fail` do revisor conta. Limite: o hook não confere a evidência `trace`, então um trace inventado ainda conta.

---

## 🔁 Escalonamento

Falha é teste que quebrou, revisão rejeitada ou erro do subagente. A tarefa pode falhar **duas vezes** no nível (`max_attempts`, padrão 2). A tentativa seguinte sobe, e as notas vão junto:

**Haiku → Sonnet → Opus**

**Tarefa difícil começa no Opus** (`hard_start: opus`, o padrão). Uma tarefa que bate numa palavra-chave de revisão do Opus (auth, pagamento, migration, schema, segurança, concorrência, mais o `risky_extra`), ou que pede uma decisão de arquitetura com trade-offs, um bug sem reprodução clara ou que atravessa módulos, ou uma investigação com hipóteses concorrentes, pula o Sonnet. Ela continua com pesquisa, spec, gate de verificação e revisão do Opus. O orquestrador implementa (no modo leve, o `cc-tiers:architect`), e se as tentativas no Opus falharem ele para e te conta. Enquanto o orçamento está economizando, ela começa no Sonnet um nível de effort acima. `hard_start: sonnet` volta ao comportamento da 0.7: o Opus só implementa o que o Sonnet não terminou. Os arquivos que a tarefa cita decidem até onde uma palavra-chave vai (`CC_TIERS_FILES`, ou os caminhos do pedido). Quando a palavra-chave está só no texto e todo arquivo citado é comum, um nome com extensão que não é caminho sensível, a tarefa não começa no Opus: começa no Sonnet um nível de effort acima, com risco `high` (o fator `risk keyword, no sensitive file named`), e a revisão dela não pode ser pulada. Sem arquivo citado, com um diretório, um nome sem extensão ou um caminho sensível como `src/auth.js`, continua começando no Opus. Palavra-chave que aparece só como texto (docs, um exemplo citado, `git checkout` numa instrução) não é risco nenhum: o orquestrador põe `CC_TIERS_RISK: none - <motivo>` nessa delegação, e o hook tira o início no Opus, o reforço de effort e a dica de roteamento. Linha sem motivo é ignorada, e o relatório de quem escreveu continua sendo checado, então um resultado que mexe em código de risco é revisado como sempre.

**Modo do escritor** (`writer`, só no `/config`: não existe chave de projeto). `tiers`, o padrão, é tudo o que está acima. `opus` faz de toda tarefa nova, as triviais incluídas, a tentativa do próprio Opus da sessão (`because: writer`, e `cc-tiers:architect` no modo leve), e uma chamada nova ao `cc-tiers:worker` ou ao `cc-tiers:implementer` para uma tarefa nova é recusada. Pesquisa, spec, gate de verificação e revisão seguem como sempre. `alternate` usa `opus` nos dias pares do horário local (contados desde 1970-01-01) e `tiers` nos ímpares. Uma tarefa mantém o modo que registrou primeiro. Uma tarefa iniciada enquanto o roteamento de orçamento está economizando é roteada como em `tiers` e registrada como `tiers`, então não conta na linha `opus`. O objetivo é comparar no seu trabalho: o `/cc-tiers:insights` tem uma tabela By writer mode (veja Telemetria e insights).

O nível novo começa do zero. O Opus é o último degrau: o orquestrador faz esse trabalho e, se essas tentativas também falharem, ele para e te conta. Rejeição de revisão conta contra o nível que escreveu o diff, não contra o checker nem contra o revisor. O roteamento de orçamento não bloqueia esse teto. A exceção é uma falha diagnosticada como `unverifiable`: no limite a tarefa para em vez de subir (veja Diagnóstico de falha).

Um hook na ferramenta Agent guarda o contador. Quando ele diz `cc-tiers counted a failure`, essa contagem é a que o orquestrador segue.

Os hooks garantem o que os prompts pedem:

- **Antes de uma delegação** (PreToolUse), a chamada a um agente do cc-tiers é recusada quando passa `model`, não tem o header `CC_TIERS_TASK` ou manda uma tarefa já escalada de volta para um nível abaixo. `CC_TIERS_TASK` é o único header que uma delegação precisa levar: o tipo do agente dá o papel e o nível, então as linhas `CC_TIERS_TIER` e `CC_TIERS_ROLE` são opcionais, e uma revisão é cobrada do nível que escreveu o diff (a tentativa que espera o gate, depois o contador da tarefa, depois o log, e por último uma linha `CC_TIERS_TIER`). Subir uma tarefa antes do limite (`/cc-tiers:escalate`) move o contador junto, com as notas.
- **Pesquisa** (`research: on`, o padrão): a chamada ao implementer ou ao architect é recusada quando a tarefa não tem nem um pass do researcher nem a linha `CC_TIERS_RESEARCH: none - <motivo>`.
- **Pesquisa de falha** (`failure_research: on`, o padrão): uma falha contada de um tipo pesquisável recebe uma nota que sugere uma busca na web, até `failure_research_max` por tarefa. Não recusa nada: a sugestão nunca é obrigatória (veja Pesquisa primeiro).
- **Especificação** (`specify: on`, o padrão): a chamada ao implementer ou ao architect é recusada quando o prompt não tem um bloco `CC_TIERS_SPEC_BEGIN` / `CC_TIERS_SPEC_END` com conteúdo nem a linha `CC_TIERS_SPEC: none - <motivo>`.
- **Verificação** (`verify: on`, o padrão): um `pass` de quem escreve só vale depois de o hook rodar os comandos de `CC_TIERS_VERIFY` que a lista ou as checagens detectadas cobrem. Um `pass` sem essas linhas, ou com um comando que falha, conta como falha. O teto Opus e o dispatcher são verificados no Stop.
- **Evidência** (`review_evidence: on`, o padrão): um `fail` do revisor ou do checker só conta com um achado bloqueante válido. O hook roda o comando do achado e descarta o que passa, e um `fail` sem achado vira notas.
- **Contrato** (`specify: on`): uma nova tentativa ou uma escalada que tira ou reescreve um critério do spec guardado é recusada até o prompt dizer o motivo em `CC_TIERS_RESPEC: <motivo>`.
- **Aprovação dos critérios** (`contract_approval`, `critical` por padrão): a chamada ao worker, ao implementer ou ao architect que tem critérios e risco igual ou acima da opção é recusada até o prompt trazer `CC_TIERS_APPROVED: user - <como>` ou `CC_TIERS_APPROVED: none - <motivo>`.
- **Orçamento da tarefa** (`task_budget_*`): a chamada a quem escreve numa tarefa que passou do orçamento é recusada até o prompt trazer `CC_TIERS_BUDGET: override - <motivo>`, depois de você concordar.
- **Escritores em paralelo**: a chamada a quem escreve cujos arquivos se sobrepõem aos de um escritor em andamento, ou que espera uma tarefa de `CC_TIERS_DEPENDS`, é recusada, e a que passa do teto `max_parallel` também. Um slug de `CC_TIERS_DEPENDS` que nenhuma delegação da sessão teve e um ciclo de dependências também.
- **Agentes em background** também contam. O lançamento grava o id do agente e quando ele começou, e o SubagentStop conta o relatório quando ele termina. O aviso chega ao orquestrador na próxima delegação ou no fim do turno. O pass de um escritor em background que chega depois de a revisão da tarefa ter passado não é contado de novo quando essa revisão foi lançada depois desse escritor: a tarefa continua terminada, e o aviso diz para mandar um diff novo para revisão só se esse escritor ainda estava editando quando a revisão começou. Um escritor lançado depois da revisão, ou um pass cujo gate falha, conta como sempre.
- **O teto Opus** não tem chamada Agent, então o orquestrador marca a própria tentativa com o header `CC_TIERS_TASK` / `CC_TIERS_TIER: opus` / `CC_TIERS_ROLE: orchestrator` e fecha com `CC_TIERS_STATUS`. O hook conta esse trailer como qualquer outro relatório.
- Agentes em paralelo dividem um arquivo de contador por sessão, com lock e gravação atômica.
- **Erros de API e de rede** (sobrecarga, rate limit, 5xx) não são falhas. O hook avisa e o mesmo nível roda de novo, então uma instabilidade não empurra trabalho para o Opus.

---

## 🪜 Effort

Cada nível também tem uma escada de effort. Uma nova tentativa no mesmo nível roda um nível de effort acima antes de a tarefa trocar de modelo, apostando que pensar mais no Sonnet pode resolver o que de outro jeito pediria um modelo novo, e para que as notas fiquem num contexto só:

| Nível | Tentativa 1 | Tentativa 2 | Tentativa 3+ |
| --- | --- | --- | --- |
| Haiku | `low` | `medium` | `medium` |
| Sonnet | `high` | `xhigh` | `xhigh` |
| Opus (`cc-tiers:architect`) | `high` | `xhigh` | `xhigh` |

O hook PreToolUse define o `effort` na chamada Agent (o `effort` por chamada do Claude Code, 2.1.292+), então o orquestrador não tem como esquecer. Ele pode pedir um nível mais alto, nunca um mais baixo, e nunca acima do topo da escada. Uma tarefa arriscada, que bate numa palavra-chave de revisão, começa um nível acima: no Sonnet (`hard_start: sonnet`, economizando, ou quando a palavra-chave é só texto e todo arquivo citado é comum) em `xhigh`, e no `cc-tiers:architect` também em `xhigh`. Enquanto o orçamento está economizando, o effort para em `high`. Quando o orquestrador Opus implementa o teto ele mesmo, ele mantém o effort da própria sessão. `CLAUDE_CODE_EFFORT_LEVEL`, quando definido, ganha de tudo isso.

`effort_ladder: off` deixa cada agente no effort que o arquivo dele fixa. Um projeto pode trocar uma escada em `.claude/cc-tiers.json` com `effort.haiku`, `effort.sonnet`, `effort.opus` e `effort.conserveCap`.

---

## 🧪 Classificador

As listas de palavras-chave são um primeiro palpite. Duas checagens ficam atrás delas antes de uma tarefa chegar ao Haiku:

- **Pontuação de complexidade**, local e de graça. Vários passos (tópicos, "and then", "e depois"), três ou mais arquivos, palavras de design ou investigação (refatorar, arquitetura, depurar, flaky, vazamento de memória) ou um briefing longo somam pontos. Com 2 pontos, uma tarefa que parece miúda começa no Sonnet. O `/cc-tiers:route` mostra a pontuação e os sinais.
- **Arquivos grandes.** Quando a tarefa cita arquivos do projeto que somam 400 KB ou mais (`largeFileBytes`), ela começa no Sonnet. É a versão do cc-tiers para roteamento por contexto longo: todo modelo atual tem janela de 1M, mas um arquivo enorme ainda é muito para uma passada barata, e o Haiku 4.5, se o seu alias `haiku` ainda aponta para ele, tem só 200K.
- **Classificador Haiku**, um hook `prompt` que roda só nas chamadas a `cc-tiers:worker`. Uma passada rápida do Haiku lê a tarefa e, quando ela não é miúda de verdade, a chamada é recusada com o motivo, e o orquestrador manda o mesmo slug para o Sonnet. Isso é correção de rota, não falha. `classifier: local` desliga: o orquestrador passa a marcar os prompts do worker com `CC_TIERS_CLASSIFY: skip`, que o hook de comando só aceita nesse modo.

---

## 🪶 Modo leve

Plano, pesquisa e revisão em contextos separados gastam mais da sua janela que uma thread só. O modo leve é para quando a janela está apertada. O orquestrador Opus lê todo pedido, até uma correção de typo, e todo subagente começa num contexto novo, então numa tarefa pequena esse custo fixo pode sair mais caro que a tarefa. Três coisas cortam isso:

- **Caminho leve** (`light_path: inline`, o padrão). Quando um pedido é uma tarefa miúda só, o hook UserPromptSubmit diz ao agente da sessão para fazer ele mesmo: sem plano, sem worker, sem checker. `delegate` manda para o worker numa chamada (o comportamento da 0.4), e `off` planeja todo pedido.
- **Caminho pequeno** (segue o `light_path`). Um pedido curto (até 40 palavras) que não casa com nenhuma palavra de revisão Opus, tem complexidade 0 e começaria no Sonnet recebe uma nota `cc-tiers small path`. O agente da sessão lê o alvo primeiro. Se a mudança cabe em cerca de 20 linhas de um arquivo (fora o arquivo de teste), tem resultado esperado claro e não usa API de biblioteca que ele não viu no repositório, ele faz sozinho: sem plano, pesquisa ou subagente, com um spec de um a três critérios, um teste que reproduz o bug quando é correção e o arquivo tem testes, e o trailer de tentativa com `CC_TIERS_REVIEW: skip`. O gate de verificação roda de novo os comandos `CC_TIERS_VERIFY` dele, sem passo de revisão. O dispatcher do modo leve faz o mesmo com o trailer dele. Com `delegate`, ou enquanto o roteamento por orçamento conserva, é uma chamada a `cc-tiers:implementer` com `CC_TIERS_RESEARCH: none`, um spec curto e `CC_TIERS_REVIEW: skip`. Mudança maior ou arriscada, ou dúvida, segue a rota de sempre, e um pedido que cita login, pagamento ou migração também, de propósito. `off` desliga junto com o caminho leve.
- **Modo leve**, o agente de sessão `cc-tiers:dispatcher` no Sonnet. Ele faz sozinho uma tarefa comum, marcando a tentativa com um trailer `CC_TIERS_ROLE: dispatcher` que os hooks contam, então duas falhas ainda levam a tarefa para o Opus. Ele só chama o Opus para três coisas: `cc-tiers:planner` para um pedido com mais de uma tarefa ou uma decisão de design, `cc-tiers:architect` para uma tarefa difícil ou que esgotou as tentativas no Sonnet, e `cc-tiers:reviewer` para trabalho arriscado.

As notas do caminho leve e do caminho pequeno terminam com a mesma regra: um pedido que só pede uma resposta, uma explicação, um estudo ou uma opinião, e não muda nada, é respondido na sessão, sem slug, spec nem implementer. Quem decide isso é o modelo da sessão, não uma lista de palavras, que errou pedidos de mudança nos dois sentidos. O orquestrador segue a regra quando nenhuma nota aparece.

Ligue o modo leve numa sessão com `claude --agent cc-tiers:dispatcher`, ou de vez com `"agent": "cc-tiers:dispatcher"` em `~/.claude/settings.json`. O planner começa num contexto novo, então para uma conversa longa que vai construindo em cima dos turnos anteriores, o orquestrador é a escolha melhor.

---

## 💸 Gasto e custo

Isto é opcional. Qualidade é o ponto do cc-tiers; esta seção só diz quanto ele gastou. Quando o [cc-cost](https://github.com/edsoncantuaria/cc-cost) está instalado, o resumo da sessão e cada tarefa terminada reportam **tokens novos por nível de modelo**. Tokens novos são entrada + escrita de cache + saída. Leituras de cache ficam de fora, a mesma regra do cc-cost. Os tokens de um subagente vêm do resultado do Agent, ou do próprio transcript dele quando rodou em background, e vão para o slug `CC_TIERS_TASK`. A mensagem do orquestrador que delega uma tarefa conta para essa tarefa, assim como os turnos dele dentro de uma tentativa no teto. Os outros turnos aparecem como `(orchestration)`. O hook lê o transcript da sessão de forma incremental, de onde o último hook parou, então os totais só crescem e sessões longas continuam baratas.

As janelas de 5h e 7d usam os tipos do cc-cost, `five_hour` e `seven_day`. O hook lê esses valores do payload do hook quando o Claude Code os inclui, do transcript à medida que é lido, e de `limits.json` ou `store.json` no diretório de dados do cc-cost (`~/.claude/plugins/data/cc-cost/`). O total do dia aparece quando esse diretório tem as chaves `novos:<dia>:<sessionId>` do cc-cost.

Se o cc-cost não está instalado, essas linhas somem. Roteamento, retentativas e revisão continuam. Uma janela sem leitura não inventa porcentagem.

O custo não precisa de outro plugin. Cada tarefa terminada ganha uma linha `cc-tiers cost`, uma estimativa a preço de lista da API da Anthropic tirada da tabela de preços em `config/routing.default.json`. Cada modelo é cobrado pelo próprio id (Opus 5.5 a $4/$20 por milhão, Sonnet 5.5 a $2/$10, Haiku 5.5 a $0,10/$0,50, modelos antigos aos preços deles), com leitura de cache no preço do modelo e escrita de cache a 1,25x a entrada, ou 2x no cache de 1 hora. Ao lado vem o custo dos mesmos tokens no preço do Opus, para comparação. Uma assinatura não é cobrada assim. `show_cost` vem `off` por padrão; ponha `on` para ver essas linhas. O `/cc-tiers:report` mostra a sessão inteira numa tabela: níveis, tentativas, escalonamentos, effort, revisão, status e custo por tarefa.

---

## 🧭 Orçamento

O roteamento de orçamento protege a sua janela Pro/Max. `budget_5h` e `budget_7d` valem 80 por padrão. Quando uma das janelas chega no limiar, a sessão diz `Budget routing: conserve`. Trabalho novo fica no Haiku ou no Sonnet. O Opus ainda planeja, ainda pega a tarefa que já esgotou as tentativas no Sonnet, e ainda revisa o que é crítico.

Uma janela cujo horário de reset já passou conta como 0, do mesmo jeito que o cc-cost desenha. Sem leitura ainda, o hook diz que o roteamento não economiza.

---

## 🧑‍🏫 Com o advisor

O [advisor](https://code.claude.com/docs/en/advisor) do Claude Code deixa um modelo consultar outro mais forte nos momentos de decisão, vendo a conversa inteira. É uma configuração da sessão (`/advisor opus`), não algo que um plugin liga por agente, e os subagentes herdam. Isso decide onde ele compensa:

- **Modo leve + advisor Opus** é a combinação boa. O dispatcher Sonnet pergunta ao Opus nos momentos difíceis sem abrir um contexto novo do `cc-tiers:planner`, e os subagentes Sonnet e Haiku também podem perguntar. Espere menos chamadas ao planner e menos escalonamentos; cada consulta lê o transcript inteiro no preço do Opus.
- **Orquestrador + advisor Opus** dobra o Opus: uma thread principal Opus consultando outro Opus. Deixe o advisor desligado aí, a não ser que o trabalho seja crítico.

Os tokens do advisor entram no `/usage`. O cc-tiers não enxerga esses tokens por tarefa, então o `/cc-tiers:report` não os inclui.

---

## 🧠 Aprendendo com o Haiku e o Sonnet

Com `learn` em `on` (o padrão), uma falha do Haiku vai para `.claude/cc-tiers-history.json` no projeto. A tarefa seguinte com o mesmo slug, ou palavras suficientes em comum, começa no Sonnet em vez do Haiku. Uma tarefa que esgotou as tentativas no Sonnet também é gravada, e uma parecida depois começa no Sonnet já no topo da escada de effort (`xhigh`), em vez de subir tudo de novo. O Opus só começa tarefas difíceis (`hard_start`). As palavras são comparadas sem acento, então `migração` e `migracao` casam. `off` não grava nada e ignora o arquivo.

A primeira gravação adiciona o arquivo ao `.git/info/exclude` quando o projeto é um checkout git (worktrees incluídas), então ele fica fora do git sem mexer no `.gitignore` versionado. O repositório do plugin também ignora esse caminho.

---

## 🏗️ Controles de engenharia

A 0.10 acrescenta controles em volta do fluxo que pesquisa, spec, implementação, verificação e revisão já faziam. Uma tarefa ganha um nível de risco, os critérios dela são mantidos entre as tentativas, uma falha é classificada antes da próxima tentativa, escritores dividem um checkout sem colidir, o projeto guarda uma memória pequena, e todo pass termina com uma linha que diz o quanto o resultado é confiável. Nenhum controle tira um gate ou um passo acima. As opções novas (`profile`, `memory`, `telemetry`, `max_parallel`, `task_budget_usd`, `task_budget_calls`, `task_budget_minutes`, `budget_warn_at`) estão na tabela de Configuração.

A 0.11 acrescenta uma opção, `contract_approval`, e aperta esses controles: um comando de verificação não pode mudar a árvore, uma falha que o repositório não consegue testar para em vez de escalar, uma falha que já existia pode ser declarada e confirmada pelo revisor Opus, os critérios de uma tarefa crítica são aprovados antes de ela começar, e uma revisão pode ler a rubrica do próprio projeto.

A 0.11.1 acrescenta duas opções, `failure_research` e `failure_research_max`, e se apoia nos mesmos controles. Uma falha pode pedir uma busca na web sobre o que ela imprimiu (Pesquisa primeiro). Uma correção de bug é reproduzida por um teste antes de ser feita, e o hook guarda o que quem escreveu declarou sobre isso (`Repro:` em Contrato do spec e conclusão). Um pacote que o manifesto declara e a árvore não tem não custa uma tentativa (Diagnóstico de falha). O gate do Stop reusa um pass de verificação na mesma árvore, a linha de conclusão diz quantas tentativas e escaladas uma tarefa levou e quantas checagens foram reusadas, e o `/cc-tiers:insights` mostra como cada nível de partida se saiu.

A próxima versão (listada como Unreleased no changelog) acrescenta uma opção, `writer`, e um comando, `/cc-tiers:redo`. O gate de verificação também roda as checagens que o cc-tiers detectou e olha através de linhas `docker exec` e compose exec. Uma delegação só precisa de `CC_TIERS_TASK`, o hook numera os critérios, e uma palavra-chave de revisão que é só texto, com arquivos comuns citados, não força mais o início no Opus. Uma revisão sem linha de status, uma rejeição que um pass posterior não apaga e um diff grande revisado em fatias ficam a cargo do hook, e o `/cc-tiers:insights` conta as tarefas que você devolveu e compara os modos do escritor.

### Avaliação de risco

O hook pontua cada tarefa a partir do pedido, dos arquivos que ela cita, do histórico e do projeto, em cinco dimensões de 0 a 3, e tira daí um nível: `low`, `medium`, `high` ou `critical`.

- **Complexidade**: a pontuação do Classificador.
- **Regressão**: uma palavra de contrato público (`endpoint`, `public api`, `contract`, `breaking`, `signature`) soma 2. Uma palavra de dependência ou de versão, ou um arquivo de manifesto ou de lock, soma 1. Arquivos em três ou mais diretórios de topo somam 1, e uma falha anterior do Sonnet numa tarefa parecida também.
- **Sensibilidade**: 3 para uma palavra de risco ou um caminho sensível, que é uma palavra inteira como `auth`, `login`, `session`, `payment`, `migration`, `schema`, `secret`, `token`, `jwt`, `password`, ou um arquivo `.env*`. 2 para dados persistentes (`database`, `sql`, `persist`, `drop`), e 2 para uma palavra de risco que está só no texto quando todo arquivo que a tarefa cita é comum (o fator `risk keyword, no sensitive file named`; veja Escalonamento).
- **Ambiguidade**: um ponto para cada hesitação ("maybe", "not sure", "figure out", "talvez") e um para duas ou mais interrogações.
- **Evidência**: 0 quando o projeto tem testes (um diretório de testes, um script de teste ou a config de um runner), 1 quando isso não se sabe, 2 quando não tem nenhum, e mais 1 depois de uma falha do Haiku numa tarefa parecida.

Sensibilidade 3 é `critical`. Sensibilidade 2, regressão 2 ou mais junto com complexidade 2 ou mais, ou uma soma de 6 ou mais de complexidade, regressão, ambiguidade e evidência, é `high`. Uma soma de 2 ou mais, ou qualquer regressão ou sensibilidade, é `medium`. O resto é `low`. O `/cc-tiers:route` imprime o nível ao lado do tier, com as pontuações e os fatores por trás, e `risky` mantém o significado de antes. Resumido, para "Add a login endpoint to src/auth.js and a users table migration":

```
{ "tier": "opus", "because": "hard", "risk": "critical",
  "riskDimensions": { "complexity": 0, "regression": 2, "sensitivity": 3, "ambiguity": 0, "evidence": 0 },
  "riskFactors": ["risk keyword", "sensitive path: src/auth.js", "public contract"] }
```

O que o nível muda:

- Uma tarefa que parece trabalho do Haiku mas tem risco `high` ou `critical` começa no Sonnet (`because: risk`). Com `hard_start: opus`, uma tarefa do Sonnet de risco `critical` começa no Opus.
- Uma tarefa `critical` começa o escritor um nível de effort acima, como uma que bate numa palavra-chave de revisão.
- O prompt de quem escreve ganha um bloco de contexto, entre `CC_TIERS_CONTEXT_BEGIN` e `CC_TIERS_CONTEXT_END`, com os ids dos critérios do spec em ordem (`Criterion ids for CC_TIERS_CRITERION lines, in spec order: C1 <texto>; ...`, quando `specify` está ligado) e as checagens do projeto que cabem no risco (veja Perfis). Os prompts do revisor e do checker também recebem a linha de ids. O bloco é dado, não instrução.
- Quem escreve não pode fechar com `CC_TIERS_REVIEW: skip` quando mudou um arquivo sensível que o prompt não citou, quando o risco é `critical`, ou quando o risco alcança o piso de revisão do perfil. `review_policy: never` é o único jeito de passar disso. Quem escreve fecha com `CC_TIERS_REVIEW: pending`, a menos que o prompt diga `skip`: a política de revisão e o risco decidem, e o hook sobrescreve um `skip` que um piso proíbe. Uma tarefa que bate numa palavra-chave de revisão do Opus mas começa no Sonnet, porque a palavra-chave é só texto, mantém a revisão também.

### Contrato do spec e conclusão

O bloco de spec vira um contrato numerado. O hook lê as linhas sob `Criteria:`, `Preserve:`, `Checks:`, `Repro:`, `Security:`, `Evidence:` e `Edge cases:` como `C1`, `C2` e assim por diante, e guarda isso na primeira delegação da tarefa. `Assumed:` e `Ambiguous:` continuam sendo notas.

```
CC_TIERS_SPEC_BEGIN
Criteria:
- GET /users takes a cursor and returns the next page (request)
Preserve:
- GET /orders keeps its current response (repo: src/orders.js:12)
Checks:
- `node --test test/users.test.mjs`
Security:
- the cursor is validated before it reaches the query (decided: it is user input)
CC_TIERS_SPEC_END
```

- Quem escreve reporta cada critério antes do trailer, como `CC_TIERS_CRITERION: C<n> pass|fail|unverifiable|na - <evidência>`. `na` e `unverifiable` pedem um motivo, e a última linha de um id vale. Os ids vêm do hook: o bloco de contexto de uma delegação de quem escreve, do revisor ou do checker os lista na ordem do spec, numa contagem só por todas as seções do bloco, então o prompt não numera os critérios sozinho.
- Um critério de `Checks:` com um comando entre crases só tem evidência quando esse comando exato passa no gate. Sem comando entre crases, fica sem evidência.
- Um critério `Repro:` com um comando entre crases só tem evidência por três coisas juntas: esse comando passa agora no gate, o relatório de quem escreveu que passou traz uma linha ``CC_TIERS_REPRO: `<comando>` - <falha antes da correção>`` para o mesmo comando, e uma revisão independente (o revisor ou o checker) passou. Sem a revisão é um pass declarado: o status é `pass`, a evidência diz `not yet confirmed by a review`, e ele não entra em `Criteria with evidence`. Com o comando passando e sem a linha de antes, fica `pending` (`no failure-before evidence`). Com `CC_TIERS_REPRO: none - <motivo>` é `unverifiable`, e o motivo é a evidência. Nada é recusado: o hook não consegue rodar o comando na base, então a falha declarada é uma afirmação que só a checagem de mutante da revisão testa. Uma tarefa com critério `Repro:` não pula a revisão: os prompts do orquestrador e do dispatcher não põem `CC_TIERS_REVIEW: skip` nela, porque só uma revisão independente a confirma. O hook lê a linha `CC_TIERS_REPRO` do relatório que passou, e por isso uma nova tentativa a repete. Uma linha `Repro:` sem comando entre crases é um critério comum.
- Um `pass` ou um `na` que quem escreveu só declarou vira evidência depois que uma revisão independente passou, nunca antes, e nunca dá confiança alta.
- Uma nova tentativa ou uma escalada que tira ou reescreve um critério é recusada. Quando o critério estava errado, o prompt diz por quê em `CC_TIERS_RESPEC: <motivo>`, e a mudança é auditada.
- O prompt do revisor e o do checker precisam levar o mesmo bloco de spec, senão a chamada é recusada.

Quando uma tarefa passa, o hook imprime uma linha de conclusão:

```
cc-tiers completion: users-pagination verified on sonnet, high risk; confidence high (gate verified 1 command). Checks run 1, passed 1, failed 0, not run 0. Criteria with evidence: 4/4.
```

Quando a tarefa falhou ou subiu de nível antes de passar, a linha diz isso depois do nível, como `on sonnet after 2 failed attempts and 1 escalation`, e quando o gate reusou checagens da mesma árvore ela diz `Checks run 2 (1 reused)`. Uma tarefa que passou de primeira, sem nada reusado, lê-se como antes. As contagens são as falhas contadas e as escaladas da tarefa, então uma falha pulada como infra ou como já existente não entra nelas. O status é `verified`, `partial`, `failed` ou `unverified`. `verified` pede um comando verificado, nenhum `na` que só quem escreveu declarou, evidência para cada critério do risco de evidência do perfil para cima, e uma revisão aprovada para risco `high` e `critical`. `failed` é um gate reprovado, uma revisão rejeitada ou um critério que falhou. A confiança é `high`, `moderate` ou `low`, e os motivos vêm depois dela. Uma tarefa `critical` sem revisão é sempre `low`, e a linha termina com `Remaining:` quando algo ficou em aberto. Critérios aprovados com `CC_TIERS_APPROVED: none` limitam a confiança a `moderate` (`criteria not approved by the user`). Uma falha declarada com `CC_TIERS_PREEXISTING` mantém o status em `partial` no máximo. `specify: off` tira o contrato.

Depois da linha de conclusão, uma tarefa com critérios ganha uma tabela deles, para colar no corpo do commit ou na descrição do PR:

```
cc-tiers criteria for users-pagination (paste into the commit or PR):
| Criterion | Status | Evidence |
| --- | --- | --- |
| C1 GET /users takes a cursor and returns the next page | pass | node --test test/users.test.mjs |
| C2 GET /orders keeps its current response | pass | reviewed: the orders route is unchanged |
| C3 `node --test test/users.test.mjs` | pass | node --test test/users.test.mjs |
| C4 the cursor is validated before it reaches the query | pass | reviewed: a cursor that is not an id gets a 400 |
```

O `Status` de um critério é `pass`, `fail`, `unverifiable`, `na` ou `pending`, e a `Evidence` é o comando que passou, ou o que quem escreveu ou a revisão disseram. Um `pass` que nenhum comando nem revisão confirmou mostra `declared`, um critério `pending` não tem evidência, uma célula longa é cortada e um `|` numa célula é escapado.

### Diagnóstico de falha

Uma falha é classificada antes da próxima tentativa: `syntax`, `type`, `test`, `regression`, `requirement`, `docs-version`, `dependency`, `integration`, `architecture`, `security`, `infra`, `flaky`, `scope`, `unverifiable` ou `unknown`. A fonte é a categoria do achado do revisor, quando há um, e a saída do gate ou o erro, quando não há. A nota da próxima tentativa leva isso:

```
Diagnosis: dependency (confirmed by the output). A module, package or command the code needs is missing from the environment.
Next: The environment is missing something: fix it, then rerun. Do not change code until then.
```

- `retry`: syntax, type, test, regression, requirement, integration, scope e unknown, com o que ler primeiro.
- `retry-research`: docs-version. Rode o `cc-tiers:researcher` de novo para a versão instalada. Quando a nota de falha sugere uma busca de falha (veja Pesquisa primeiro), essa busca substitui este conselho.
- `rerun-env`: dependency, infra e flaky. Conserte o ambiente e rode de novo; não mude código.
- `escalate`: architecture e security.
- `report-partial`: unverifiable. No limite de tentativas a tarefa para em vez de subir de nível, com uma mensagem que pede a parte que dá para verificar, um relatório `partial` e o ambiente de teste que falta, nomeado.
- A mesma falha duas vezes (texto citado, caminhos e números à parte), ou nenhuma tentativa sobrando, também sobe a tarefa. No Opus é `stop`.

`unverifiable` é uma falha que o repositório não consegue exercitar, então outra tentativa, neste nível ou num mais forte, também não poderia ser conferida. Só a razão de quem relatou decide isso (uma linha da saída do runner nunca decide), é a última regra (qualquer outra categoria vence) e nunca vale quando a razão ou a saída fala de segurança, auth, login, session, role, permissão, 401 ou 403, API key, JWT, token, segredo, credencial ou senha: uma falha assim nunca é reportada como parcial. As palavras são casadas como estão no código; em português ele reconhece segurança, autenticação, autorização, permissão, credencial, senha, segredo, "acesso negado" e "papel de", mas não "sessão" nem "chave de API". A razão precisa dizer que não dá para testar, reproduzir ou verificar aqui; um teste ou uma credencial que falta, sozinho, não prova nada.

Um diagnóstico é **confirmado** só por uma categoria do revisor ou pela saída de um comando, e para dependency e infra só por uma assinatura de máquina (`Cannot find module`, `command not found`, `ECONNREFUSED`, `ENOSPC`, `EADDRINUSE`). Palavras no relatório de quem escreveu fazem uma hipótese, e a nota diz `suspected from the reason`. Um nome de teste ou uma mensagem de assertion que tem essas palavras é falha de código, não de ambiente. Uma falha de infra confirmada no gate não conta como falha, até 2 por tarefa; a terceira conta, então uma queda de serviço não empurra o trabalho para um nível acima e um loop não se esconde atrás dela. Essa contagem, a única declaração `CC_TIERS_PREEXISTING` que uma tarefa pode usar e as buscas de falha que a tarefa recebeu ficam com a tarefa quando ela troca de nível.

**Um pacote declarado mas não instalado.** Uma falha `dependency` confirmada do gate também não é contada, sob a mesma contagem e o mesmo limite da infra (2 por tarefa), quando nomeia um pacote que o manifesto da raiz do projeto declara e a árvore não tem: a nota diz `<nome> is declared in the project manifest but not installed` e manda instalá-lo. Para Node, a saída nomeia um specifier simples (`Cannot find module 'left-pad'`, ou `Cannot find package`), não há diretório `node_modules/<nome>`, e o nome está em `dependencies`, `devDependencies`, `peerDependencies` ou `optionalDependencies` do `package.json` da raiz; um pacote com escopo conta como `@scope/name`. Para Python, a saída diz `No module named` com um módulo sem ponto, e o `pyproject.toml` da raiz (`dependencies`, `optional-dependencies` ou `dependency-groups` da PEP 621, ou uma tabela de dependências do Poetry, lidos linha a linha e não como TOML) ou um `requirements*.txt` da raiz o lista, comparado como o pip compara (maiúsculas, `-`, `_` e `.` iguais). Os site-packages do Python não ficam à vista, então para Python a declaração decide. Estes ainda contam como falha: um módulo local (um caminho que começa com `.`, `/`, `~`, `#`, `@/` ou uma letra de unidade), um pacote que o manifesto não declara (o import do próprio escritor), uma falha de subcaminho ou de nome com ponto, como `lodash/fp` ou `yaml.foo` (o pacote em si foi resolvido), um comando ausente, um timeout e um nome no pip diferente do nome do import (`PyYAML` e `yaml`).

### Protocolo de revisão

O revisor e o checker agora podem usar categorias mais finas e severidades graduadas. As cinco categorias do bloco de evidência continuam, e `access-control`, `input-validation`, `data-exposure`, `error-handling`, `concurrency`, `api-usage` e `compatibility` entram junto. `severity` é `blocking`, `note`, ou uma entre `blocker`, `high`, `medium`, `low`, `suggestion`.

```
CC_TIERS_FINDING_BEGIN
category: input-validation
severity: high
confidence: high
justification: the cursor reaches the query as typed
scenario: GET /users?cursor=1%20OR%201=1 returns every row
evidence: trace
expected: a 400 for a cursor that is not an id
observed: 200 with all rows
where: src/users.js:58
CC_TIERS_FINDING_END
```

- `blocker` e `high` contam como bloqueantes, como `blocking`, e pedem `confidence` (`low`, `medium` ou `high`) e `justification`. Um de baixa confiança vira nota. `medium`, `low` e `suggestion` são notas. `scenario`, `confidence` e `justification` são opcionais nos demais.
- Um prompt de revisão ganha um bloco de foco de revisão, entre `CC_TIERS_CONTEXT_BEGIN` e `CC_TIERS_CONTEXT_END`: até 5 de 8 classes de risco (controle de acesso, validação de entrada, exposição de dados, concorrência, consistência de estado, APIs externas, tratamento de erro, compatibilidade com o que já existe) escolhidas pelas palavras do diff e do pedido. Um achado bloqueante continua precisando de evidência.
- **Rubrica do projeto**: um projeto pode acrescentar `.claude/cc-tiers-rubric.md` com as próprias regras de revisão, até 4 KiB. Um prompt de revisão a recebe no mesmo bloco, com segredos mascarados (veja Redação de segredos) e rotulada como dado do repositório, nunca instrução. Precisa ser um arquivo comum dentro do projeto, com links simbólicos resolvidos; um arquivo ausente, de fora ou ilegível não acrescenta nada, e o que passa de 4 KiB é cortado. O revisor cita a linha da rubrica a que um achado corresponde, e a rubrica nunca decide o veredito.
- Um prompt de revisor ou checker que leve o trailer de quem escreveu (uma linha `CC_TIERS_ROLE` de escritor e uma linha `CC_TIERS_STATUS`) é recusado: a revisão recebe o diff, o spec, a pesquisa e o pedido, nunca o relatório de quem escreveu.

### Perfis

`profile` move alguns limiares juntos. `balanced`, o padrão, é o comportamento da 0.9. Defina no `/config`, ou em `.claude/cc-tiers.json` quando o `/config` deixa o campo vazio.

| Perfil | Effort de quem escreve | Evidência a partir de | Revisão a partir de | Escritores em paralelo | Itens de memória | Checagens |
| --- | --- | --- | --- | --: | --: | --- |
| `balanced` (padrão) | escada | `medium` | `critical` | 4 | 5 | por risco |
| `quality` | um nível acima | `low` | `high` | 3 | 8 | uma profundidade a mais |
| `budget` | escada | `medium` | `critical` | 2 | 3 | por risco |
| `fast` | escada | `high` | `critical` | 6 | 3 | uma profundidade a menos |

- **Effort de quem escreve**: `quality` começa um escritor Sonnet ou Opus um nível de effort acima do primeiro degrau da escada dele. Uma nova tentativa continua subindo a partir daí.
- **Evidência a partir de**: o menor risco a partir do qual cada critério precisa de evidência (um comando verificado ou uma revisão aprovada) para o status `verified`. Abaixo dele a regra é leve; a partir dele, padrão; para `high` e `critical`, forte.
- **Revisão a partir de**: o menor risco a partir do qual `CC_TIERS_REVIEW: skip` é recusado.
- **Escritores em paralelo**: o teto quando `max_parallel` é 0.
- **Itens de memória**: quantas notas lembradas, no máximo, quem escreve recebe.
- **Checagens**: o hook lê as checagens que o projeto declara (os scripts `test`, `lint` e `typecheck` do `package.json`, `tsconfig.json`, uma config do ESLint, `phpunit.xml`, `phpstan.neon`, `pytest`, `go.mod`, `Cargo.toml`, `package-lock.json`) e diz a quem escreve as que cabem no risco. Profundidade 0 e 1 são as checagens de teste, e a 0 pede os testes que cobrem a mudança. A profundidade 2 soma a checagem de tipos e o lint. A 3 é toda checagem, `npm audit --omit=dev` incluído. No `balanced`, `low` é profundidade 0, `medium` 1 e `high` 2. O gate roda uma checagem detectada exatamente como listada, mesmo quando o `verify_allow` não tem entrada para ela.

Nenhum perfil tira um agente, um gate, um critério ou um passo, nem passa por cima de um valor do `/config`, nem baixa o que uma tarefa `critical` recebe: ela sempre tem profundidade 3, revisão e evidência forte.

```json
{ "profile": "quality" }
```

### Orçamento da tarefa

`budget_5h` e `budget_7d` guardam a sua janela de uso. O orçamento da tarefa guarda uma tarefa só: um loop de tentativas fora de controle, ou uma tarefa que cresce além do que você queria. As quatro opções vêm desligadas.

| Chave | Padrão | Significado |
| --- | --- | --- |
| `task_budget_usd` | `0` | Custo estimado, a preços de tabela da API, a partir do qual as chamadas de escrita daquela tarefa pedem sua aprovação. 0–1000, 0 é sem limite |
| `task_budget_calls` | `0` | Chamadas Agent que uma tarefa pode fazer. 0–200, 0 é sem limite |
| `task_budget_minutes` | `0` | Minutos desde a primeira delegação da tarefa. 0–1440, 0 é sem limite |
| `budget_warn_at` | `80` | Porcentagem de um limite em que o cc-tiers avisa antes. 50–99 |

Perto de um limite, o hook avisa: `cc-tiers: users-pagination is close to its budget (calls 8/10).` Acima dele, o hook recusa novas chamadas de escrita daquela tarefa. As chamadas de revisão e de verificação continuam rodando, então o que foi construído ainda pode ser conferido. O orquestrador te pergunta; quando você concorda, ele acrescenta esta linha à delegação, e o hook deixa a chamada passar com uma nota:

```
CC_TIERS_BUDGET: override - the user approved more calls for the pagination work
```

Chamadas e minutos são medidos. O custo é uma estimativa a partir da contagem de tokens, nunca um valor cobrado. Uma tarefa `critical` acima do orçamento pede a sua decisão e não é pulada em silêncio.

### Memória

Com `memory` em `on` (o padrão), o projeto guarda notas pequenas em `.claude/cc-tiers-memory.json`, para a tarefa seguinte não redescobrir tudo. A primeira gravação adiciona o arquivo ao `.git/info/exclude`, como no arquivo de histórico. `off` não lê nem grava.

- **Categorias**: `convention`, `command`, `failure`, `fix`, `dead-end`, `version` e `warning`. Um registro tem uma confiança (`low`, `medium`, `high`), um status (`hypothesis` ou `confirmed`) e um prazo de validade: `convention` e `warning` valem até serem invalidados, `command` e `version` 30 dias, `failure` e `dead-end` 60, `fix` 90. O limite é 200 registros.
- **Preso a um arquivo**: um registro que depende de um arquivo guarda o hash dele. Quando o arquivo muda, o registro fica vencido e não é lembrado.
- **O que o hook grava**: um comando que o gate verificou (preso ao manifesto que o declara), uma falha diagnosticada, uma correção depois de um pass que veio após falhas, e um beco sem saída quando uma tarefa é parada. Segredos e linhas `CC_TIERS_*` saem antes (veja Redação de segredos).
- **Lembrança**: quem escreve recebe as notas que têm duas ou mais palavras em comum com a tarefa dele, ou o mesmo slug, no máximo o número do perfil. Elas chegam entre `CC_TIERS_MEMORY_BEGIN` e `CC_TIERS_MEMORY_END`, marcadas como dado de tarefas anteriores, nunca instrução.

```
/cc-tiers:memory list
/cc-tiers:memory add convention Tests sit next to the code and run with node --test
/cc-tiers:memory invalidate m-9f3a17ebaf the test script was renamed
```

O comando é `/cc-tiers:memory [list [--all] | add <categoria> <texto> | invalidate <id> <motivo> | delete <id> | prune | clear --yes]`. Uma nota que você adiciona é confirmada, com confiança alta. `clear` pede `--yes`. `list --all` inclui os registros vencidos e invalidados.

### Escritores em paralelo

Escritores que rodam ao mesmo tempo num checkout podem sobrescrever um ao outro. Uma delegação diz quais arquivos ela toca, e o hook mantém um registro dos escritores em andamento:

```
CC_TIERS_TASK: users-pagination
CC_TIERS_FILES: src/users.js, src/routes/*.js, test/users.test.mjs
CC_TIERS_DEPENDS: users-schema
```

- `CC_TIERS_FILES` lista caminhos e diretórios. Um glob vira o diretório fixo dele (`src/routes/*.js` vira `src/routes/`). `.`, mais de 40 entradas, um caminho absoluto ou um `../` significa o projeto inteiro. Sem o header, o hook cai nos caminhos que o prompt cita.
- Escritores cujos arquivos se sobrepõem, ou cujos arquivos são desconhecidos, rodam um de cada vez: a segunda chamada é recusada até a primeira terminar.
- `CC_TIERS_DEPENDS` bloqueia a chamada até cada tarefa listada ter passado. Em vez de esperar para sempre, a chamada é recusada quando um slug listado é um que nenhuma delegação da sessão teve (a mensagem o nomeia), ou quando as dependências formam um ciclo, direto ou por uma terceira tarefa (a mensagem dá o caminho do ciclo).
- Uma chamada Agent com `isolation: "worktree"` nunca conflita em arquivos, e continua contando para o teto.
- `max_parallel` (0–16, padrão 0) limita os escritores ao mesmo tempo. 0 usa o teto do perfil: 4 no `balanced`.
- Um escritor cujo relatório nunca voltou é liberado depois de 2 horas, e o Stop libera todos os parados (os de background ficam). `CC_TIERS_RELEASE: <slug>` numa delegação libera um à mão.
- Depois que escritores que rodaram com `isolation: "worktree"` passam, o orquestrador integra o resultado de cada um na branch de trabalho na ordem do `CC_TIERS_DEPENDS` (cherry-pick ou merge do commit), para no primeiro conflito e o reporta, nunca o resolve com `-X ours` nem `-X theirs`, e roda o gate de verificação na árvore integrada, não só em cada worktree.
- Um pedido com duas ou mais tarefas de escrita ganha mais uma chamada ao `cc-tiers:reviewer` sobre o diff integrado inteiro antes do relatório final, com o pseudo-slug `final-gate`: todos os blocos de spec e uma linha `CC_TIERS_VERIFY` com o comando de teste amplo do projeto. Como todo prompt de revisão, ele leva o diff, nunca os relatórios dos escritores.
- Agentes que dividem a árvore nunca rodam `git stash`, `git checkout`, `git reset`, `git restore` nem `git clean` nela. Uma linha de base vem de uma cópia de trabalho fora do repositório.

### Guarda do workspace

Antes e depois de cada tentativa de quem escreve, o hook tira uma foto da árvore de trabalho: `git status` e um hash do conteúdo de cada arquivo alterado. O que a tentativa mudou é a diferença, e o hook reporta duas coisas que o prompt não pediu:

- **Arquivos sensíveis** que o prompt não citou: arquivos `.env`, material de chave, chaves SSH, arquivos de credencial e de credencial de registry, workflows de CI, lockfiles, configurações do Claude, internos do git, `Dockerfile` e arquivos do Compose. Um pass assim não pode pular a revisão.
- **Arquivos fora de `CC_TIERS_FILES`**, quando o header está lá. Um arquivo de teste conta como dentro do escopo quando testa um arquivo declarado pelo nome.

Quando a árvore tem mais de 400 arquivos alterados, a foto é cortada e não dá fingerprint. Outra tarefa aberta no mesmo checkout também pode mudar arquivos, e a nota diz isso.

A cada carregamento, o estado das tarefas é validado. Uma entrada com slug inválido, tier desconhecido, lista de falhas inválida, ou mais falhas do que o limite abaixo do Opus é descartada, vai para a auditoria e é reportada ao orquestrador uma vez.

### Telemetria e insights

Com `telemetry` em `on` (o padrão), o hook acrescenta um evento pequeno por transição em `events.jsonl`, no diretório de dados do plugin: `task.received`, `risk.assessed`, `model.selected`, `research.done`, `research.failure`, `criteria.defined`, `implementation.done`, `verify.done`, `failure.diagnosed`, `escalated`, `review.done`, `task.passed`, `task.stopped`, `budget.warning`, `state.recovered`, `task.redone` e `task.redo.undone`. Um evento guarda campos de uma lista permitida (slug, tier, nível de risco, categoria, contagens), nunca texto de prompt nem de arquivo, e passa pela redação de segredos. O arquivo roda uma vez para `events.1.jsonl` acima de 1 MB. `reduced` guarda só `escalated`, `failure.diagnosed`, `task.passed`, `task.stopped`, `budget.warning`, `task.redone` e `task.redo.undone`; `off` não grava nada. Nada sai da sua máquina.

O `/cc-tiers:insights` lê esse log e imprime falhas por categoria, motivos de escalada, custo estimado por nível de risco, gates que não foram validados e a confiança nas tarefas que passaram. Também imprime duas tabelas do que aconteceu, sem conselho. **Routing in hindsight** tem uma linha por nível em que uma tarefa começou (o nível do primeiro evento `model.selected` dela): as tarefas, quantas passaram ali sem escalar, quantas escalaram e o nível em que cada uma terminou, quantas pararam e quantas passaram depois de um achado bloqueante da revisão. **Failure research by match** tem uma linha por `CC_TIERS_MATCH` que uma busca de falha reportou (`high`, `partial`, `none` ou `unknown` quando o relatório não tinha um válido): as buscas, as tarefas que tiveram uma e quantas dessas tarefas passaram depois sem escalar. Quando tarefas que começaram no Opus em risco `low` ou `medium` passaram sem escalada, sem falha diagnosticada e sem achado bloqueante da revisão, uma linha diz `Possibly over-routed: N task(s) ...` e que é uma pista para olhar, não um veredito. Uma amostra de menos de 10 tarefas é marcada como pequena, e a saída diz que isso não é motivo para mudar o roteamento. O comando nunca edita config nem roteamento.

**Pedidos de novo.** `/cc-tiers:redo <slug> [motivo]` marca uma tarefa concluída como devolvida por você, e `/cc-tiers:redo --undo <slug>` tira uma marca. O slug é procurado nesta sessão primeiro, depois na sessão mais nova que o tenha. O hook também conta um pedido de novo sozinho: um prompt (que não seja um slash command) que cita uma tarefa concluída desta sessão pelo slug, como palavra inteira, e traz uma palavra de reclamação (`still`, `broken`, `again`, `wrong`, `ainda`, `quebrou` e parecidas, em inglês e em português) acrescenta uma marca e avisa, com o comando `--undo` para desfazer. O texto do prompt nunca é guardado. Cada marca grava um evento `task.redone` com o nível, o motivo (cortado em 200 caracteres e mascarado) e a `source` (`command` ou `prompt`), e um desfazer grava `task.redo.undone`. Com `telemetry: off` nenhum evento é gravado, e a marca fica no estado da sessão.

O `/cc-tiers:insights` transforma as marcas em `Sent back by the user: N of M tasks`, uma tabela delas pelo nível em que a tarefa terminou e, em Real use, uma coluna de devolvidas na tabela de projetos. O número é um piso: um pedido de novo só conta quando você o marcou ou o seu prompt citou a tarefa e reclamou. Quando uma tarefa registrou um modo do escritor, uma tabela **By writer mode** tem uma linha por modo: as tarefas, quantas terminaram sem nenhuma falha, quantas você devolveu, quantas tiveram um achado bloqueante da revisão e o custo estimado em USD. Real use tem a mesma tabela sem a coluna do achado bloqueante.

### Redação de segredos

A memória, a telemetria e a trilha de auditoria guardam só texto que passou antes por `hooks/redact.mjs`. Ele mascara chaves privadas, chaves de provedor (`sk-`, `pk-`, `glpat-`, `npm_`, `ghp_` e as parecidas, `github_pat_`, `xox`, `AKIA`, `AIza`, URLs de webhook do Slack), JWTs, credenciais dentro de URLs, valores de `Bearer`, `Basic` e `Token`, headers `Cookie`, flags no estilo `--password` e `--token`, pares `chave=valor` cuja chave nomeia um segredo, e endereços de e-mail. `[redacted]` entra no lugar do valor e a chave continua legível.

### Relatório e notas de sessão

- O `/cc-tiers:report` tem mais quatro colunas no fim: Risk, Completion, Confidence e Time. O tempo é medido, mostrado como `N s` ou `N.N min`; o rodapé diz que o tempo é medido e o custo é estimado.
- O SessionStart lista o trabalho aberto que encontra no estado da sessão (uma tarefa com falhas, uma revisão pendente, um escritor que estava rodando, um pass do teto esperando o gate) e diz que nada é rodado de novo sozinho: confira o `git status` e a árvore de trabalho antes de delegar ou revisar de novo.
- O contexto da sessão informa o perfil, a memória, a telemetria, o orçamento da tarefa, se a pesquisa de falha está ligada e o limite dela, e as regras de paralelismo e de contrato em vigor.
- O `.claude/cc-tiers.json` também pode definir `profile`, `memory`, `telemetry`, `maxParallel`, `taskBudgetUsd`, `taskBudgetCalls`, `taskBudgetMinutes`, `budgetWarnAt`, `contractApproval`, `failureResearch` e `failureResearchMax`. O `/config` ganha quando os dois estão definidos.

### Falhas dos hooks

Um erro interno num hook do cc-tiers nunca vale como sucesso. `before_agent`, `after_agent`, `subagent_stop` e `stop` o capturam, até quando o próprio `hooks/cc_tiers.mjs` não carrega, gravam uma linha em `hook-errors.jsonl` na pasta de dados do plugin (hora, sessão, hook, slug da tarefa, o erro já mascarado) e avisam:

- Antes de uma delegação, a chamada `cc-tiers:*` é recusada com o motivo; outro agente passa com um aviso. O hook de comando do PreToolUse tem `"onFailure": "block"`, então uma queda que ele não captura, ou o timeout de 15 s, também recusa a chamada.
- Depois de um agente, o orquestrador fica sabendo que o relatório não foi contado, o gate não rodou e a tarefa não está validada.
- No Stop, a parada é bloqueada uma vez com esse aviso (só aviso quando o Claude já está continuando por um hook de parada). Num prompt, o aviso entra no contexto.
- O próximo hook que funcionar marca as tarefas citadas nessas linhas. Uma tarefa assim nunca fecha como `verified`: no máximo `partial`, confiança baixa, com o motivo na linha de conclusão. Uma tarefa que já tinha fechado perde o `verified` do mesmo jeito, e o `/cc-tiers:report` mostra `hook error`.

### Limitações

- Um SubagentStop que falha não pode bloquear, porque isso manteria o subagente rodando: o aviso chega ao orquestrador no próximo hook que funcionar.
- O lock de estado espera 3 s; depois disso um hook segue sem ele, então uma sessão muito ocupada pode perder uma contagem.
- A foto do workspace vem do `git status`, então arquivos que o git ignora não são vistos.
- Sem `CC_TIERS_FILES`, o escopo são os caminhos que o prompt cita. Caminhos absolutos são descartados, então um prompt que cita só esses tem escopo desconhecido e o escritor dele roda sozinho.
- O Claude Code não documenta por completo como um hook reescreve o prompt do Agent (`updatedInput`), nem o que o PostToolUse enxerga dele. O cc-tiers guarda o estado de que precisa no PreToolUse, em vez de ler de volta o prompt reescrito.
- A redação casa padrões conhecidos. Um segredo num formato que ela não conhece pode passar.
- O diagnóstico lê texto. Uma chamada flaky ou de infra é hipótese, a menos que uma assinatura de máquina confirme.
- Uma linha `Checks:` sem comando entre crases não casa com nenhuma execução, então fica sem evidência.
- A pontuação de risco é uma heurística de palavras-chave e caminhos, não uma leitura do código.
- A regra `unverifiable` é baseada em palavras-chave e erra para o lado de tentar de novo: um cabeçalho `test session starts` do pytest, ou uma palavra como "author" na saída, impede que ela dispare, e a tarefa tenta de novo e escala como antes.
- A checagem da árvore é pulada enquanto outros escritores rodam na mesma árvore, então um comando que muda arquivos passa sem ser marcado.
- Um escritor lançado depois que o gate começou não é conhecido por ele: a checagem roda mesmo assim, e as edições desse escritor podem parecer do comando.
- A confirmação de falha que já existia depende de o revisor rodar o comando numa cópia da base. O cc-tiers não roda lá por conta própria, então uma revisão que passa sem rodar é aceita na confiança. A checagem `Repro:` tem o mesmo limite: o hook vê o comando passar agora, mas só a checagem de mutante da revisão o roda na base, e a linha de falha antes é uma afirmação de quem escreveu.
- A limpeza das linhas de falha que vão para o pesquisador na web troca um caminho absoluto até o primeiro espaço, então o resto de um caminho POSIX que tem um espaço pode ficar na linha.
- A tabela de hindsight identifica uma tarefa pelo slug, então um slug reutilizado entre sessões vira uma tarefa só.
- Um slug reutilizado na mesma sessão mantém as contagens de falha e de escalada da execução anterior, e a linha de conclusão diz `after N failed attempts` por elas.
- Uma busca de falha é uma sugestão: nada obriga o orquestrador a rodá-la, e o limite conta as notas que a ofereceram, não as buscas que rodaram.
- A pontuação de risco por caminho julga nomes de arquivo, não código. Código de auth num arquivo com nome comum (`src/tokens.js`: "tokens" não é a palavra inteira `token`) começa no Sonnet com revisão forçada, não no Opus, e um diretório cujo nome tem ponto e não termina em barra conta como arquivo.
- Os números de devolvidas são um piso. Um pedido de novo com outras palavras passa batido, e um prompt que cita um slug e reclama de outra coisa é contado até você rodar `--undo`.
- Uma fatia de revisão lançada antes do próximo relatório de quem escreve que chega depois dele é cobrada da tentativa nova.
- Uma linha `docker exec` é julgada pelo comando de dentro do container. Se esse container tem o mesmo código da árvore, não é conferido.
- O cc-tiers não roda benchmark de modelo por conta própria. A telemetria é local e descritiva, e o `/cc-tiers:insights` não ajusta nada.

---

## 💬 Comandos

| Comando | O que faz |
| --- | --- |
| `/cc-tiers:tiers [tarefa]` | Planeja, encaminha e executa |
| `/cc-tiers:route [tarefa]` | Diz o nível e para. Usa a mesma heurística dos hooks. Sem editar |
| `/cc-tiers:escalate [slug]` | Sobe essa tarefa um nível agora, com as notas |
| `/cc-tiers:report [--all]` | Tabela por tarefa da sessão: níveis, tentativas, effort, revisão, verify, status e custo ao lado do preço do Opus, depois risco, conclusão, confiança e tempo medido. A coluna Verify diz `ok`, `flaky` ou `not validated` |
| `/cc-tiers:memory [list\|add\|invalidate\|delete\|prune\|clear]` | Lista, adiciona, invalida, apaga, limpa os vencidos ou zera o que o cc-tiers lembra deste projeto. Não edita código |
| `/cc-tiers:redo <slug> [motivo]` | Marca uma tarefa concluída como devolvida por você, para os números de devolvidas do `/cc-tiers:insights` a contarem. `--undo <slug>` tira uma marca. Não edita código |
| `/cc-tiers:insights` | Falhas por categoria, motivos de escalada, custo estimado por risco, gates não validados e confiança, mais como cada nível de partida se saiu (routing in hindsight), as contagens de pesquisa de falha, as tarefas que você devolveu e os modos do escritor, a partir da telemetria local. Não muda nada |

Dá também para pedir em linguagem comum. A skill `tiers` entra quando o pedido é implementar, corrigir, renomear ou revisar. Mencione um agente direto com `@agent-cc-tiers:worker`, `@agent-cc-tiers:implementer`, `@agent-cc-tiers:checker` ou `@agent-cc-tiers:reviewer`.

---

## 🎬 Exemplo

Você: "Renomeia `fetchUser` para `loadUser` em `api.ts` e adiciona paginação no `GET /users`."

1. O orquestrador Opus divide em `rename-fetch-user` (Haiku) e `users-pagination` (Sonnet).
2. O Haiku renomeia o símbolo e a checagem passa. A política é `risky`, e um rename de um arquivo não é arriscado, então ele não ganha passe de revisão.
3. `users-pagination` é uma tarefa normal, então o pesquisador roda primeiro. Ele lê o lock, acha a versão do framework em uso, abre a documentação dessa versão em `node_modules/` e cita como o `GET /orders` já pagina. O briefing entra no prompt do Sonnet.
4. O Sonnet adiciona a paginação com effort `high`. O teste do cursor falha. É a falha 1, então o Sonnet tenta de novo em `xhigh` com o traceback no prompt. Os testes passam.
5. A rota é API pública, então o revisor Opus lê o diff num contexto novo e rejeita: o cursor não é validado. É a falha 2 no Sonnet.
6. O limite é 2, então a tarefa sobe para o Opus com as duas notas, o traceback e a revisão. O orquestrador pesquisa essa tentativa ele mesmo, corrige a validação, e o revisor aprova na passada seguinte.
7. O orquestrador reporta os dois slugs, o nível que fechou cada um, quem revisou, e que a paginação escalou. Com `show_cost` em `on`, cada slug também traz a linha de custo.

Um "adiciona paginação para users" depois, neste repositório, começa no Sonnet, porque o Haiku já falhou nesse tipo e `learn` está `on`.

---

## ⚙️ Configuração

Abra `/config` e ajuste as linhas do cc-tiers. Valem na sessão seguinte (o hook de SessionStart lê esses valores).

| Chave | Padrão | Significado |
| --- | --- | --- |
| `max_attempts` | `2` | Falhas permitidas num nível antes de subir. 1–5 |
| `review_policy` | `risky` | `risky`, `cheap`, `always` ou `never` |
| `learn` | `on` | Grava falhas do Haiku e manda tarefas parecidas para o Sonnet. `off` desliga |
| `budget_5h` | `80` | Porcentagem da janela `five_hour` que começa a economizar. 1–100 |
| `budget_7d` | `80` | Porcentagem da janela `seven_day` que começa a economizar. 1–100 |
| `trivial_extra` | vazio | Frases separadas por vírgula que entram na lista do Haiku |
| `risky_extra` | vazio | Frases separadas por vírgula que entram na revisão do Opus |
| `effort_ladder` | `on` | Sobe o effort numa nova tentativa antes de trocar de modelo. `off` mantém o effort de cada agente |
| `classifier` | `haiku` | `haiku` adiciona a checagem do Haiku nas chamadas ao worker. `local` usa só palavras-chave e a pontuação de complexidade |
| `light_path` | `inline` | Uma tarefa miúda ou pequena: `inline` faz na sessão, `delegate` manda para o worker ou o implementer, `off` planeja |
| `hard_start` | `opus` | Onde começa a tarefa difícil (palavra-chave de revisão, arquitetura, bug sem reprodução): `opus`, ou `sonnet` para o Opus implementar só depois que o Sonnet falhar |
| `writer` | `tiers` | Quem escreve as tarefas novas: `tiers` (o roteamento acima), `opus` (a tentativa do próprio Opus da sessão em toda tarefa nova, as triviais incluídas) ou `alternate` (`opus` nos dias pares, `tiers` nos ímpares). Para comparar no seu trabalho. Só no `/config` |
| `show_cost` | `off` | `on` mostra o custo estimado de cada tarefa e da sessão ao lado do preço do Opus |
| `research` | `on` | Exige um briefing do pesquisador, ou uma linha `none - <motivo>`, antes de o código ir para o implementer ou o architect. `off` tira o passo |
| `failure_research` | `on` | Depois de uma falha contada diagnosticada como docs-version, type, integration, test ou regression, a nota de falha sugere rodar o `cc-tiers:researcher` sobre a mensagem de falha e a versão instalada. Nunca obrigatório. `off` tira a sugestão |
| `failure_research_max` | `1` | Quantas notas de falha de uma tarefa, em todos os níveis dela, podem sugerir uma busca. 0–5. 0 se comporta como `off` |
| `specify` | `on` | Exige critérios de aceite, ou uma linha `CC_TIERS_SPEC: none - <motivo>`, antes de o código ir para o implementer ou o architect, e deixa o orquestrador perguntar o que muda o resultado. `off` tira o passo |
| `verify` | `on` | O `pass` de quem escreve precisa listar os comandos que o provam em linhas `CC_TIERS_VERIFY`, e o hook roda os que estão na lista. `off` aceita o pass só pelo relatório |
| `verify_allow` | veja abaixo | Prefixos de comando, separados por vírgula, que o gate pode rodar, comparados por palavras inteiras. Um valor substitui o padrão, então mantenha as entradas que já estão lá ao acrescentar uma. `docker exec` não está no padrão, mas uma linha `docker exec` ou `docker compose exec` roda quando o comando de dentro é coberto. Vazio usa o padrão |
| `verify_timeout` | `300` | Segundos que um comando do gate pode rodar antes de contar como falha. 10–600 |
| `verify_budget` | `600` | Segundos que o gate pode gastar em um relatório. Comandos além disso ficam não validados, não reprovados. 30–600 |
| `review_evidence` | `on` | O `fail` do revisor só conta com um achado bloqueante que tenha evidência. `off` conta qualquer `fail` |
| `profile` | `balanced` | `balanced`, `quality`, `budget` ou `fast`. Move juntos effort, evidência, revisão, escritores em paralelo, memória e checagens. Veja Perfis |
| `memory` | `on` | Guarda notas do projeto em `.claude/cc-tiers-memory.json` e entrega as que servem a quem escreve. `off` não lê nem grava |
| `telemetry` | `on` | `on` grava eventos locais, `reduced` só os que importam para falha e escalada, `off` não grava nada |
| `max_parallel` | `0` | Escritores ao mesmo tempo. 0–16, 0 usa o teto do perfil |
| `task_budget_usd` | `0` | Custo estimado, a preços de tabela da API, a partir do qual as chamadas de escrita da tarefa pedem sua aprovação. 0–1000, 0 é sem limite |
| `task_budget_calls` | `0` | Chamadas Agent que uma tarefa pode fazer. 0–200, 0 é sem limite |
| `task_budget_minutes` | `0` | Minutos desde a primeira delegação da tarefa. 0–1440, 0 é sem limite |
| `budget_warn_at` | `80` | Porcentagem de um limite em que o cc-tiers avisa antes. 50–99 |
| `contract_approval` | `critical` | A partir de que risco os critérios de uma tarefa precisam do seu OK antes da primeira delegação: `critical`, `high` ou `off`. Sem humano, `CC_TIERS_APPROVED: none - <motivo>` limita a confiança a moderate |

O `verify_allow` padrão é `npm test, npm run test, node --test, npx tsc, npx eslint, npx vitest, npx jest, npx playwright test, vendor/bin/phpunit, ./vendor/bin/phpunit, vendor/bin/phpstan, ./vendor/bin/phpstan, vendor/bin/phpcs, ./vendor/bin/phpcs, pytest, python -m pytest, go test, cargo test`.

`risky` é o padrão: o Opus revisa trabalho não trivial num contexto novo e pula um passe trivial do Haiku. `cheap` manda a saída do Haiku para o checker Sonnet e só manda revisão Opus para uma frase de revisão ou para o teto. `always` revisa todo passe (Haiku no Sonnet, o resto no Opus). `never` pula a revisão. Enquanto uma janela de orçamento está economizando, a revisão Opus fica para o trabalho crítico mesmo em `risky` ou `always`.

O roteamento usa dois tipos de lista. **Frases** (`when`, `reviewWhen` e as opções `_extra`) casam quando a frase inteira aparece na tarefa. **Palavras-chave** (`haiku.keywords`, `opus.reviewKeywords`) casam no começo de uma palavra, sem diferenciar maiúsculas nem acentos: `migra` acha "migration" e "migração", `authent` acha "authentication" mas não "author". As palavras-chave embutidas cobrem renomear, typos, formatação e buscas para o Haiku, e auth, pagamentos, migrações, schemas, APIs públicas, segurança e concorrência para a revisão Opus, em inglês e português. Uma tarefa que parece miúda mas bate numa palavra-chave de revisão, ou soma 2 de complexidade (`sonnet.complexKeywords` é um dos sinais), começa no Sonnet.

Para trocar uma lista inteira, crie `.claude/cc-tiers.json` no projeto. A lista que você incluir substitui aquela lista; as que você omitir ficam no padrão. O mesmo arquivo pode definir `learn`, `budget5h`, `budget7d`, `profile`, `memory`, `telemetry`, `maxParallel`, `taskBudgetUsd`, `taskBudgetCalls`, `taskBudgetMinutes`, `budgetWarnAt`, `contractApproval`, `failureResearch` e `failureResearchMax` quando o `/config` deixa esses campos vazios. O `/config` continua ganhando quando os dois estão definidos. Veja `config/cc-tiers.example.json`.

```json
{
  "learn": "on",
  "budget5h": 80,
  "budget7d": 80,
  "trivialExtra": ["changelog edits"],
  "tiers": {
    "haiku": { "when": ["rename a symbol in one or two files", "changelog edits"] },
    "opus": { "reviewKeywords": ["authent", "payment", "migrat", "terraform"] }
  },
  "effort": { "sonnet": ["medium", "high", "max"], "conserveCap": "high" }
}
```

A ordem de escalonamento é fixa. As frases e palavras-chave de roteamento, o limite de tentativas, as escadas de effort, a política de revisão, o gate de pesquisa, a pesquisa de falha, o gate de especificação, o gate de verificação e a revisão com evidência, o classificador, o aprendizado, os dois limiares de orçamento, o perfil, a memória, a telemetria, o teto de escritores, o orçamento da tarefa e a aprovação dos critérios são os controles.

---

## 📊 Medindo o uso real

O `/cc-tiers:insights` termina com uma seção **Real use**, feita dos arquivos de estado de sessão que o cc-tiers guarda (`session-*.json`), só com agregados: tarefas, quantas terminaram, em que níveis começaram e terminaram, quantas terminaram sem falha ou depois de uma, quantas escalaram e terminaram, quantas foram revisadas, as contagens de verificação e de conclusão, e o custo estimado ao lado dos mesmos tokens a preços do Opus. Os projetos aparecem como `project 1`, `project 2`, ... ordenados pelo número de tarefas, então a saída não nomeia tarefa, sessão, caminho nem projeto. Para medir um arquivo das suas próprias sessões, aponte para uma pasta de dados do plugin desse arquivo (ele lê só essa pasta, sem subpastas): `/cc-tiers:insights --sessions <dir>`.

Medido no trabalho do próprio autor, de 20 a 22 de outubro de 2026, cc-tiers 0.9.0 a 0.11.1: 84 tarefas em 19 sessões, em 3 projetos. Um usuário e uma amostra pequena, então leia como descrição, não como veredito. Ela é anterior à medida de pedidos de novo, então a tabela não tem uma linha de devolvidas.

| Uso real | Tarefas |
| --- | --: |
| Terminaram no Sonnet / Opus / Haiku | 33 / 45 / 0 |
| Concluídas, de 84 | 77 |
| Concluídas sem nenhuma falha | 57 |
| Concluídas depois de pelo menos uma falha, pega antes da entrega | 20 |
| Escaladas (todas concluídas) | 7 |
| Verificação não validada | 41 |
| Custo estimado / mesmos tokens a preços do Opus | US$ 200,78 / US$ 214,25 |

Real use também diz quantas das tarefas concluídas você devolveu (`N of the M done tasks were sent back by the user`). Dois limites: esse número só conta um pedido de novo quando você o marcou com `/cc-tiers:redo` ou o seu prompt citou a tarefa e reclamou, então é um piso, e o comando não sabe o que o Opus puro teria gasto. A coluna a preços do Opus precifica os mesmos tokens, e o Opus puro não usaria exatamente esses. Para comparar no seu trabalho, ponha `writer` em `alternate` por um tempo: Real use passa a mostrar uma tabela By writer mode.

---

## 📋 Requisitos

- Claude Code **2.1.295+** (os seletores do `/config` usam `userConfig.options`, o hook PreToolUse usa `onFailure`, e a escada de effort usa o `effort` por chamada da 2.1.292).
- Node.js 18+ no `PATH` como `node`. Os hooks chamam `node` direto, então rodam igual no bash, no Git Bash e no PowerShell do Windows. Não chamam Python.

## 🛠️ Desenvolvimento

```bash
git clone https://github.com/edsoncantuaria/cc-tiers
cd cc-tiers
npm test
claude plugin validate --strict .
claude --plugin-dir .
```

> [!WARNING]
> Só copiar a pasta para um projeto não carrega o plugin. Use a instalação pelo marketplace ou `--plugin-dir`. Não deixe os dois ativos ao mesmo tempo, senão os agentes aparecem duplicados.

### Organização

| Caminho | Responsável por |
| --- | --- |
| `.claude-plugin/plugin.json` | Nome, metadados e os controles do `/config` |
| `.claude-plugin/marketplace.json` | Entrada do marketplace, source `./` |
| `settings.json` | Agente da sessão: `orchestrator` |
| `agents/*.md` | Orquestrador, revisor, planner e architect Opus, researcher, implementer, checker e dispatcher Sonnet, worker Haiku |
| `skills/tiers/SKILL.md` | `/cc-tiers:tiers` |
| `commands/route.md` | `/cc-tiers:route` |
| `commands/escalate.md` | `/cc-tiers:escalate` |
| `config/routing.default.json` | Listas de frases embutidas, escadas de effort e limiares padrão |
| `hooks/hooks.json` | Resumo no SessionStart, as checagens, o effort, o classificador Haiku e o contador do Agent, SubagentStop, Stop e UserPromptSubmit |
| `hooks/cc_tiers.mjs` | Regras de merge, o contador, gasto, orçamento e histórico |
| `hooks/route.mjs` | A heurística por trás do `/cc-tiers:route` |
| `hooks/verify.mjs` | O gate de verificação: ler `CC_TIERS_VERIFY`, a lista de prefixos, rodar os comandos e julgar os achados |
| `hooks/report.mjs` | A tabela por trás do `/cc-tiers:report` |
| `commands/report.md` | `/cc-tiers:report` |
| `commands/memory.md` | `/cc-tiers:memory` |
| `commands/insights.md` | `/cc-tiers:insights` |
| `commands/redo.md` | `/cc-tiers:redo` |
| `hooks/redo.mjs` | O auxiliar por trás do `/cc-tiers:redo`: acha a tarefa, marca ou desmarca o pedido de novo e grava o evento |
| `hooks/base.mjs` | Funções compartilhadas pelos módulos abaixo: caminhos, listas de arquivos e dólares |
| `hooks/risk.mjs` | A pontuação de risco: cinco dimensões e o nível |
| `hooks/contract.mjs` | O spec como critérios numerados, os relatórios de critério e o status de conclusão |
| `hooks/diagnose.mjs` | As categorias de falha, a próxima ação, as linhas que uma busca de falha recebe e a checagem de pacote ausente |
| `hooks/policy.mjs` | Os perfis, as checagens do projeto e as checagens que um risco escolhe |
| `hooks/budget.mjs` | O orçamento por tarefa: limites, status e o aviso |
| `hooks/memory.mjs`, `hooks/memory_cli.mjs` | A memória do projeto e o auxiliar por trás do `/cc-tiers:memory` |
| `hooks/parallel.mjs` | O registro dos escritores em andamento, o escopo de arquivos, as dependências e o teto |
| `hooks/workspace.mjs` | Fotos da árvore de trabalho, arquivos sensíveis e fora do escopo, e a validação do estado |
| `hooks/telemetry.mjs`, `hooks/insights.mjs` | O log local de eventos e o auxiliar por trás do `/cc-tiers:insights` |
| `hooks/integrity.mjs` | Falhas dos hooks: o registro em `hook-errors.jsonl` e o aviso de que o trabalho não está validado |
| `hooks/redact.mjs` | A máscara de segredos antes da memória, da telemetria e da trilha de auditoria |
| `.github/workflows/ci.yml` | Testes no Linux, macOS e Windows, e `claude plugin validate` |
| `CHANGELOG.md` | Notas da versão |

## 🔒 Privacidade

Nada sai da sua máquina, e os hooks de comando não fazem chamadas de rede. O cc-tiers guarda um log local de eventos (veja Telemetria e insights), que `telemetry: off` desliga. Com `classifier: haiku`, o hook classificador manda o input de cada chamada a `cc-tiers:worker` para o Haiku pelo Claude Code, do mesmo jeito que a sessão fala com o Claude. Quando o orquestrador roda uma busca de falha, as consultas web do pesquisador levam a mensagem de falha, a biblioteca e a versão, limpas de segredos, caminhos absolutos e tokens `CC_TIERS_`; `failure_research: off` tira a sugestão. Os hooks leem os arquivos de roteamento, as opções de plugin que o Claude Code já passa, o transcript da sessão, `.claude/cc-tiers-rubric.md` quando uma revisão roda e o projeto tem um, e os dados locais do cc-cost quando esse plugin está instalado. Gravam o contador de tentativas no diretório de dados do plugin (`latest.json` e um arquivo por sessão), o log de eventos `events.jsonl` (e `events.1.jsonl`) ali, a menos que a telemetria esteja `off`, e, com o aprendizado ligado, `.claude/cc-tiers-history.json` no projeto mais uma linha em `.git/info/exclude`. Com a memória ligada, gravam também `.claude/cc-tiers-memory.json` no projeto, mantido fora do git por uma linha própria em `.git/info/exclude`. Os eventos não guardam texto de prompt nem de arquivo, e os dois arquivos passam antes pela redação de segredos. Desinstalar o plugin remove o diretório de dados, a menos que você passe `--keep-data`. Os arquivos de histórico e de memória ficam no projeto até você apagá-los.

---

Feito com ☕ por [@edsoncantuaria](https://github.com/edsoncantuaria) · [MIT](LICENSE)

Se ele te deu respostas melhores, deixa uma ⭐
