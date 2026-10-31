"""Write docs/programas.md: every split program, cycle 1, as the engine generates it for a machine gym.

    cd backend && .venv/bin/python scripts/gen_programs_doc.py > ../docs/programas.md
"""

from knightfall.domain import Implement, Mode, Tier
from knightfall.generator import CyclePosition, generate_session
from knightfall.tiers import TIERS

# The machine gym the programs were designed around (no shoulder-press machine, kettlebell, sled,
# trap bar, medicine ball, band or roller): their stand-ins show here.
GYM = frozenset({
    Implement.LEG_PRESS, Implement.LEG_EXTENSION, Implement.LEG_CURL, Implement.SMITH, Implement.HACK_SQUAT,
    Implement.CALF_MACHINE, Implement.HIP_MACHINE, Implement.LAT_PULLDOWN, Implement.ROW_MACHINE,
    Implement.CHEST_PRESS, Implement.PEC_DECK, Implement.CABLE, Implement.DUMBBELL, Implement.BARBELL,
    Implement.ERGOMETER,
})
ORDER = (Tier.GOTHAM_ARMOR, Tier.NORTON_FB, Tier.CONJUGATE, Tier.BATFLECK, Tier.PUSH_PULL_LEGS,
         Tier.UPPER_LOWER, Tier.FULL_BODY)
WEEKDAYS = ("segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo")


def volume(rx) -> str:
    if rx.mode == Mode.REPS:
        n = rx.reps or rx.reps_per_side
        r = f"{n}–{rx.reps_max}" if rx.reps_max else str(n)
        return f"{rx.sets} × {r}" + (" /lado" if rx.reps_per_side else "")
    if rx.mode == Mode.TIMED:
        s = rx.duration_seconds
        return f"{rx.sets} × {s // 60} min" if s >= 60 else f"{rx.sets} × {s} s"
    if rx.mode == Mode.HOLD:
        side = f" × {rx.reps_per_side}/lado" if rx.reps_per_side and rx.reps_per_side > 1 else (
            " /lado" if rx.reps_per_side else "")
        return f"{rx.sets} × {rx.hold_seconds} s{side}"
    return f"{rx.sets} × {rx.distance_m} m"


def rest(rx) -> str:
    if rx.rest_seconds is None:
        return "—"
    if rx.rest_seconds == 0:
        return "sem descanso"
    if rx.rest_seconds % 60 == 0:
        return f"{rx.rest_seconds // 60} min"
    return f"{rx.rest_seconds / 60:.1f} min".replace(".", ",") if rx.rest_seconds > 90 else f"{rx.rest_seconds} s"


def main() -> None:
    print("""# Knightfall · Programas

> Gerado por `backend/scripts/gen_programs_doc.py` a partir do motor de treino (`backend/knightfall/splits.py`):
> as tabelas são a saída real do código para o **ciclo 1**, com o perfil de uma academia de máquinas (leg press,
> hack, smith, extensora, flexora, panturrilha, abdutora/adutora, puxador, remada, supino máquina, voador, polia,
> halteres, barra e cardio; **sem** desenvolvimento em máquina, kettlebell, trenó, trap bar, medicine ball, elástico
> ou rolo) e prontidão verde. Sem histórico de cargas, por isso não há carga sugerida nem aquecimento calculado.

## Como os programas funcionam

- **Máquina primeiro.** Cada vaga tem opções em ordem de preferência; entra a primeira que o perfil de equipamentos
  tem, e os substitutos da vaga só quando nenhuma existe.
- **Potência logo depois do aquecimento.** Saltos, arremessos e sprints vêm antes de qualquer série de força, com
  90 a 180 s de descanso e sem esforço alvo: cada repetição é máxima, e a série para quando a velocidade cai.
- **48 h entre sprint e perna pesada.** Dias com sprint ou agilidade ficam a pelo menos dois dias do agachamento
  ou do terra pesado (um teste confere todos os programas).
- **Básicos fixos, acessórios rodando.** O bloco Principal não muda entre ciclos; os acessórios trocam a cada ciclo.
  No Conjugado, o exercício de esforço máximo alterna toda semana (supino e supino no chão; terra e box squat).
- **Esforço alvo.** O RIR (repetições em reserva) do protocolo vira a escala do app: RIR 1 = esforço 9, RIR 2 = 8.
- **Top set + back-off** a 80% da carga do top set, onde o programa pede.
- **Prontidão vermelha** corta as séries para 60% e tira o finalizador; **deload** a cada 6 ciclos.
- **Programas semanais** (Armadura de Gotham, Functional Bodybuilding, Conjugado): o dia 1 é segunda-feira.
""")
    for tier in ORDER:
        cfg = TIERS[tier]
        print(f"## {cfg.name}\n\n{cfg.description}\n")
        if cfg.volume_targets:
            from knightfall.volume import MUSCLE_LABEL

            bands = ", ".join(f"{MUSCLE_LABEL[m].lower()} {lo}–{hi}" for m, (lo, hi) in cfg.volume_targets.items())
            print(f"Séries por semana que o programa mira: {bands}.\n")
        weekly = tier in (Tier.GOTHAM_ARMOR, Tier.NORTON_FB, Tier.CONJUGATE)
        for d in range(1, cfg.cycle_length + 1):
            s = generate_session(tier, CyclePosition(0, d), "doc", equipment=GYM)
            when = f"Dia {d}" + (f" ({WEEKDAYS[d - 1]})" if weekly else "")
            if not s.blocks:
                print(f"### {when} · Descanso\n")
                continue
            print(f"### {when} · {s.day_name} ({s.target_duration_minutes} min)\n")
            for b in s.blocks:
                print(f"**{b.name}** · {b.duration_minutes} min\n")
                print("| Exercício | Volume | Esforço alvo | Descanso | Observações |")
                print("|---|---|---|---|---|")
                for rx in b.exercises:
                    role = {"top": "top set", "backoff": "back-off 80%"}.get(rx.set_role or "", "")
                    notes = "; ".join(x for x in [role, rx.intensity or "", *rx.cues] if x) or "—"
                    rpe = f"{rx.target_rpe:g}".replace(".", ",") if rx.target_rpe else "—"
                    print(f"| {rx.name} | {volume(rx)} | {rpe} | {rest(rx)} | {notes} |")
                print()


if __name__ == "__main__":
    main()
