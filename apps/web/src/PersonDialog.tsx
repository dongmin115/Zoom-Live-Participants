import { studyTier } from "./format.ts";
import Portal from "./Portal.tsx";
import StudyIcon from "./StudyIcon.tsx";
import type { PersonStat } from "./api.ts";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

function hours(seconds: number): string {
	if (seconds === 0) return "0";
	if (seconds < 60) return "1분 미만";
	if (seconds < 3600) return `${Math.round(seconds / 60)}분`;

	const h = seconds / 3600;
	return h >= 10 ? `${Math.round(h)}시간` : `${h.toFixed(1)}시간`;
}

function short(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	return `${date.slice(5)} ${WEEKDAY[d.getUTCDay()] ?? ""}`;
}

/**
 * 한 사람의 기록.
 *
 * 랭킹에서 이름을 누르면 열린다. 순위표는 누가 위인지만 말해주므로,
 * 어떻게 쌓았는지는 여기서 본다.
 */
export default function PersonDialog({
	person,
	onClose,
}: {
	person: PersonStat;
	onClose: () => void;
}) {
	const average = person.days > 0 ? person.seconds / person.days : 0;
	const tier = studyTier(average);
	const daily = person.daily ?? [];
	const max = Math.max(...daily.map((d) => d.seconds), 1);

	return (
		<Portal>
			<div
				className="overlay"
				role="dialog"
				aria-modal="true"
				aria-labelledby="person-title"
				onClick={(event) => {
					if (event.target === event.currentTarget) onClose();
				}}
			>
				<div className="dialog person">
					<div className="person__head">
						<StudyIcon tier={tier} face="🧑‍💻" label={`하루 평균 ${hours(average)}`} />
						<div>
							<p className="person__name" id="person-title">
								{person.displayName}
							</p>
							<p className="person__sub">
								{`하루 평균 ${hours(average)}`}
							</p>
						</div>
					</div>

					<dl className="person__facts">
						<div>
							<dt>누적</dt>
							<dd>{hours(person.seconds)}</dd>
						</div>
						<div>
							<dt>출석</dt>
							<dd>{`${person.days}일`}</dd>
						</div>
						<div>
							<dt>{person.streakAlive ? "연속" : "마지막 연속"}</dt>
							<dd>
								{`${person.streak}일`}
								{person.streakAlive && person.streak >= 2 && (
									<span className="person__fire" aria-hidden="true">
										🔥
									</span>
								)}
							</dd>
						</div>
						<div>
							<dt>최고 연속</dt>
							<dd>{`${person.bestStreak}일`}</dd>
						</div>
					</dl>

					<ul className="chart person__daily">
						{daily.map((d) => (
							<li key={d.date} className="chart__row">
								<span className="chart__label">{short(d.date)}</span>
								<span className="chart__track">
									<span
										className="chart__fill"
										style={{ width: `${(d.seconds / max) * 100}%` }}
									/>
								</span>
								<span className="chart__value">{hours(d.seconds)}</span>
							</li>
						))}
					</ul>

					<div className="dialog__actions">
						<button type="button" className="dialog__button" onClick={onClose}>
							닫기
						</button>
					</div>
				</div>
			</div>
		</Portal>
	);
}
