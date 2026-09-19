import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchStats, type PersonStat, type Stats as StatsData } from "./api.ts";
import { studyTier } from "./format.ts";
import Columns from "./Columns.tsx";
import DayView from "./DayView.tsx";
import PersonDialog from "./PersonDialog.tsx";
import StudyIcon from "./StudyIcon.tsx";
import ThemeToggle from "./ThemeToggle.tsx";

/**
 * 최상위 셋. 무엇을 고르느냐가 다르다.
 *
 *   스냅샷   날짜 하나       그날의 참가자 목록
 *   기간별   시작일~종료일   그 기간의 통계
 *   월별     달 하나         그 달의 통계
 *
 * 미리 정한 보기(4주·8주…)를 고르게 하지 않는다. 보고 싶은 기간은 사람마다
 * 다르고, 고정 보기는 늘 어긋난다.
 */
type Mode = "day" | "range" | "month";

const MODES: { id: Mode; label: string }[] = [
	{ id: "day", label: "스냅샷" },
	{ id: "range", label: "기간별" },
	{ id: "month", label: "월별" },
];

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const MEDAL = ["🥇", "🥈", "🥉"];

const DAY_MS = 24 * 60 * 60 * 1000;

/** 한국 시간 기준 오늘. */
function today(): string {
	return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shiftDays(date: string, days: number): string {
	return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
		.toISOString()
		.slice(0, 10);
}

/** 그 달의 첫날과 마지막날. */
function monthRange(month: string): { from: string; to: string } {
	const [year, mm] = month.split("-").map(Number);
	const last = new Date(Date.UTC(year ?? 2026, mm ?? 1, 0)).getUTCDate();

	return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** 통계는 시간 단위로 읽는다. 초까지 보여줄 이유가 없다. */
export function hours(seconds: number): string {
	if (seconds === 0) return "0";
	// 30초 남짓 있다 나간 사람이 "0분" 으로 뜨면 고장으로 읽힌다
	if (seconds < 60) return "1분 미만";
	if (seconds < 3600) return `${Math.round(seconds / 60)}분`;

	const h = seconds / 3600;
	return h >= 10 ? `${Math.round(h)}시간` : `${h.toFixed(1)}시간`;
}

/** 09-08 (월) */
export function dayLabel(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	return `${date.slice(5)} (${WEEKDAY[d.getUTCDay()] ?? ""})`;
}

/**
 * 칸 이름.
 *
 *   2026-09  →  9월
 *   2026-09-07  →  09-07   (주로 묶였으면 그 주의 시작일)
 */
function periodLabel(key: string): string {
	return key.length === 7 ? `${Number(key.slice(5))}월` : key.slice(5);
}

function Bar({
	label,
	value,
	max,
	suffix,
	note,
	dim,
}: {
	label: string;
	value: number;
	max: number;
	suffix?: string;
	note?: string;
	dim?: boolean;
}) {
	return (
		<li className={dim ? "chart__row chart__row--dim" : "chart__row"}>
			<span className="chart__label">{label}</span>
			<span className="chart__track">
				<span
					className="chart__fill"
					style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }}
				/>
			</span>
			<span className="chart__value">
				{hours(value)}
				{suffix && <span className="chart__suffix">{suffix}</span>}
			</span>
			{note && <span className="chart__note">{note}</span>}
		</li>
	);
}



/** 지난 7일과 그 앞 7일. 늘었으면 위, 줄었으면 아래. */
function WeekCard({ week }: { week: StatsData["comparison"] | undefined }) {
	// 웹은 즉시 배포되고 API 는 수동이다. 그 사이에 옛 응답이 올 수 있으므로
	// 없는 필드를 읽고 화면 전체가 죽는 일은 없어야 한다.
	if (!week) return null;

	const { current: recent, previous } = week;

	if (recent.seconds === 0 && previous.seconds === 0) return null;

	const diff = previous.seconds > 0
		? Math.round(((recent.seconds - previous.seconds) / previous.seconds) * 100)
		: null;

	const up = diff !== null && diff > 0;
	const flat = diff === 0;

	return (
		<div className="week">
			<div className="week__main">
				<p className="week__label">이 기간</p>
				<p className="week__value">{hours(recent.seconds)}</p>
			</div>
			<p
				className={
					diff === null || flat
						? "week__diff"
						: up
							? "week__diff week__diff--up"
							: "week__diff week__diff--down"
				}
			>
				{diff === null
					? "견줄 앞 기간 없음"
					: flat
						? "직전과 같음"
						: `${up ? "▲" : "▼"} ${Math.abs(diff)}%`}
				{previous.seconds > 0 && (
					<span className="week__prev">{`직전 같은 기간 ${hours(previous.seconds)}`}</span>
				)}
			</p>
		</div>
	);
}

/** 처음에 보여줄 인원. 76명을 다 펼치면 아래 구역들이 화면 밖으로 밀린다. */
const RANK_PREVIEW = 10;

export function Ranking({
	people,
	onOpen,
}: {
	people: PersonStat[];
	onOpen: (person: PersonStat) => void;
}) {
	const [expanded, setExpanded] = useState(false);

	if (people.length === 0) return <p className="empty">기록이 없습니다</p>;

	const shown = expanded ? people : people.slice(0, RANK_PREVIEW);
	const rest = people.length - shown.length;

	return (
		<>
		<ol className="rank">
			{shown.map((person, index) => {
				const average = person.days > 0 ? person.seconds / person.days : 0;
				const tier = studyTier(average);

				return (
					<li key={person.displayName}>
						<button
							type="button"
							className="rank__row"
							onClick={() => onOpen(person)}
						>
							<span className="rank__place">
								{MEDAL[index] ?? index + 1}
							</span>
							<StudyIcon
								tier={tier}
								face="🧑‍💻"
								label={`하루 평균 ${hours(average)}`}
								small
							/>
							<span className="rank__body">
								<span className="rank__name">{person.displayName}</span>
								<span className="rank__meta">
									{`${person.days}일 · 하루 ${hours(average)}`}
									{person.streakAlive === true && person.streak >= 2 && (
										<span className="rank__streak">
											{`🔥 ${person.streak}일 연속`}
										</span>
									)}
								</span>
							</span>
							<span className="rank__total">{hours(person.seconds)}</span>
						</button>
					</li>
				);
			})}
		</ol>
		{rest > 0 && (
			<button
				type="button"
				className="rank__more"
				onClick={() => setExpanded(true)}
			>
				{`${rest}명 더 보기`}
			</button>
		)}
		</>
	);
}

/**
 * 날짜 고르기.
 *
 * 화살표로 앞뒤 날을 오가고, 달력으로 아무 날이나 바로 짚는다.
 *
 * 화살표는 **기록이 있는 날로** 건너뛴다. 하루씩 옮기면 빈 날에서 멈춰
 * 몇 번을 더 눌러야 하는지 알 수 없다. 더 갈 곳이 없으면 눌리지 않는다.
 */
function DayPicker({
	days,
	value,
	onChange,
}: {
	days: StatsData["days"];
	value: string;
	onChange: (date: string) => void;
}) {
	const withRecords = days.filter((d) => d.seconds > 0).map((d) => d.date);
	const index = withRecords.indexOf(value);

	// 목록에 없는 날(달력으로 직접 짚은 빈 날)이면 앞뒤로 가장 가까운 날을 찾는다
	const prev =
		index > 0
			? withRecords[index - 1]
			: [...withRecords].reverse().find((d) => d < value);
	const next =
		index >= 0
			? withRecords[index + 1]
			: withRecords.find((d) => d > value);

	return (
		<div className="daynav">
			<button
				type="button"
				className="daynav__arrow"
				onClick={() => prev && onChange(prev)}
				disabled={!prev}
				aria-label="이전 날"
			>
				←
			</button>

			<div className="daynav__center">
				<input
					type="date"
					className="daynav__field"
					value={value}
					min={withRecords[0]}
					max={withRecords[withRecords.length - 1]}
					onChange={(event) => onChange(event.target.value)}
					aria-label="날짜"
				/>
				<span className="daynav__weekday">
					{value ? dayLabel(value).slice(-3) : ""}
				</span>
			</div>

			<button
				type="button"
				className="daynav__arrow"
				onClick={() => next && onChange(next)}
				disabled={!next}
				aria-label="다음 날"
			>
				→
			</button>
		</div>
	);
}

function Periods({ buckets }: { buckets: StatsData["weeks"] }) {
	const withRecords = buckets.filter((b) => b.seconds > 0);

	if (withRecords.length === 0) return <p className="empty">기록이 없습니다</p>;

	return (
		<>
			<Columns
				items={buckets.map((b) => ({
					key: b.key,
					label: periodLabel(b.key),
					value: b.seconds,
				}))}
				format={hours}
				labelEvery={buckets.length > 8 ? 2 : 1}
				peakLabel="가장 많았던"
			/>

			<ul className="facts">
				{[...withRecords].reverse().map((b) => (
					<li key={b.key} className="facts__row">
						<span className="facts__label">{periodLabel(b.key)}</span>
						<span className="facts__value">{hours(b.seconds)}</span>
						<span className="facts__note">
							{`${b.people}명 · 하루 ${hours(b.seconds / Math.max(b.activeDays, 1))}`}
						</span>
					</li>
				))}
			</ul>
		</>
	);
}

export function Summary({ data }: { data: StatsData }) {
	const busiest = [...data.hours].sort((a, b) => b.seconds - a.seconds)[0];

	return (
		<>
			<header className="header">
				<p className="header__label">{`${data.from} ~ ${data.to}`}</p>
				<p className="header__count">
					{hours(data.totalSeconds)}
					<span className="header__unit">누적</span>
				</p>
				<p className="header__meta">
					{`${data.totalPeople}명 참여`}
					{busiest && busiest.seconds > 0 && ` · 붐비는 시간 ${busiest.hour}시`}
				</p>
			</header>

			<WeekCard week={data.comparison} />

			{data.typicalStart && data.typicalEnd && (
				<p className="stats__typical">
					{`보통 ${data.typicalStart} 에 시작해서 ${
						// 끝이 시작보다 이르면 자정을 넘긴 것이다
						data.typicalEnd < data.typicalStart ? "다음날 " : ""
					}${data.typicalEnd} 에 끝납니다`}
				</p>
			)}
		</>
	);
}

function Body({
	data,
	onOpen,
}: {
	data: StatsData;
	onOpen: (person: PersonStat) => void;
}) {
	// 기간이 길면 날짜 하나하나가 너무 잘다. 칸 수가 감당할 만한 단위를 고른다.
	const span = data.days.length;
	const buckets =
		span <= 45 ? data.days.map((d) => ({ key: d.date, seconds: d.seconds, people: d.people, activeDays: d.seconds > 0 ? 1 : 0 })) : span <= 200 ? data.weeks : data.months;

	// 요일은 그 요일이 몇 번 있었는지가 다르다. 합계로 견주면 기간에 두 번 든
	// 요일이 유리해진다. 하루 평균으로 고쳐 놓고 본다.
	const weekdayAvg = data.weekdays.map((w) => ({
		...w,
		average: w.days > 0 ? w.seconds / w.days : 0,
	}));

	return (
		<>
			<Periods buckets={buckets} />

			<h3 className="stats__title stats__title--gap">랭킹</h3>
			<Ranking people={data.people} onOpen={onOpen} />

			{/* 하루의 모양. 24칸이라 라벨은 세 시간마다 */}
			<h3 className="stats__title stats__title--gap">시간대</h3>
			<Columns
				items={data.hours.map((h) => ({
					key: String(h.hour),
					label: `${h.hour}`,
					value: h.seconds,
				}))}
				format={hours}
				labelEvery={3}
				peakLabel="가장 붐비는 시간"
			/>

			<h3 className="stats__title stats__title--gap">요일</h3>
			<Columns
				items={weekdayAvg.map((w) => ({
					key: String(w.weekday),
					label: WEEKDAY[w.weekday] ?? "",
					value: w.average,
				}))}
				format={hours}
				peakLabel="가장 많이 모이는 요일"
			/>
		</>
	);
}

function DaySection({
	days,
	date,
	onChange,
}: {
	days: StatsData["days"];
	date: string;
	onChange: (date: string) => void;
}) {
	const latest = days.filter((d) => d.seconds > 0).at(-1)?.date;
	const shown = date || latest || today();

	return (
		<>
			<DayPicker days={days} value={shown} onChange={onChange} />
			<DayView date={shown} />
		</>
	);
}

export default function Stats() {
	const [mode, setMode] = useState<Mode>("day");
	// 비워 두고 데이터가 오면 기록이 있는 가장 최근 날을 연다. 오늘 아직
	// 아무도 안 왔으면 어제를 보여주는 편이 빈 화면보다 낫다.
	const [date, setDate] = useState("");
	// 기본은 오늘까지 한 주. -6 이면 오늘을 포함해 7일이다.
	const [from, setFrom] = useState(() => shiftDays(today(), -6));
	const [to, setTo] = useState(today);
	const [month, setMonth] = useState(() => today().slice(0, 7));
	const [selected, setSelected] = useState<PersonStat | null>(null);

	// 스냅샷은 날짜를 고르는 화면이라 어느 날에 기록이 있는지 알아야 한다.
	// 그래서 통계와 다른 범위를 받는다.
	const asked =
		mode === "day"
			? { from: shiftDays(today(), -89), to: today() }
			: mode === "month"
				? monthRange(month)
				: { from, to };

	const { data, isPending, isError, error } = useQuery({
		queryKey: ["stats", asked.from, asked.to],
		queryFn: () => fetchStats(asked.from, asked.to),
		// 시작일이 종료일보다 늦으면 물어볼 것이 없다
		enabled: asked.from <= asked.to,
	});

	return (
		<main className="screen">
			<div className="topbar">
				<a className="topbar__back" href="/">
					← 접속 현황
				</a>
				<div className="topbar__actions">
					<ThemeToggle />
				</div>
			</div>

			<nav className="tabs">
				{MODES.map((m) => (
					<button
						key={m.id}
						type="button"
						className={mode === m.id ? "tab tab--on" : "tab"}
						onClick={() => setMode(m.id)}
					>
						{m.label}
					</button>
				))}
			</nav>

			{mode === "range" && (
				<div className="pick">
					<input
						type="date"
						className="pick__field"
						value={from}
						max={to}
						onChange={(event) => setFrom(event.target.value)}
						aria-label="시작일"
					/>
					<span className="pick__tilde">~</span>
					<input
						type="date"
						className="pick__field"
						value={to}
						min={from}
						max={today()}
						onChange={(event) => setTo(event.target.value)}
						aria-label="종료일"
					/>
				</div>
			)}

			{mode === "month" && (
				<div className="pick">
					<input
						type="month"
						className="pick__field"
						value={month}
						max={today().slice(0, 7)}
						onChange={(event) => setMonth(event.target.value)}
						aria-label="월"
					/>
				</div>
			)}

			{isPending && <p className="empty">불러오는 중…</p>}
			{isError && (
				<p className="empty">
					{error instanceof Error ? error.message : "불러오지 못했습니다"}
				</p>
			)}

			{data && mode === "day" && (
				<DaySection days={data.days} date={date} onChange={setDate} />
			)}

			{data && mode !== "day" && (
				<>
					<Summary data={data} />
					<Body data={data} onOpen={setSelected} />
				</>
			)}

			{selected && (
				<PersonDialog person={selected} onClose={() => setSelected(null)} />
			)}
		</main>
	);
}
