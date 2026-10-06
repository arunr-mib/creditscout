# Skills

The five CreditScout skills live in **`.claude/skills/`**, not here.

The Cohort 10 week-5 lab keeps them at `skills/` and reaches them by explicit
`@skills/<name>/SKILL.md` reference in the prompt. This project uses
`.claude/skills/` instead so Claude Code **discovers them automatically** and
exposes each one as a slash command — `/engineering-planner`,
`/implementation-specs`, `/frontend-setup`, `/design-system`,
`/security-foundation`.

Same five skills, same Purpose / Inputs / Instructions / Output contract. Only
the discovery mechanism differs.

| Skill | Run when |
|---|---|
| `/engineering-planner` | The PRD changed and the architecture needs to catch up |
| `/implementation-specs` | Before writing implementation code |
| `/frontend-setup` | Once, before the first screen |
| `/design-system` | Every time UI is written or reviewed |
| `/security-foundation` | Before any deploy |
