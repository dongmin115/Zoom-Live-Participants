import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
	fetchNotices,
	fetchPresence,
	saveStatusMessage,
	type Notice,
	type PresenceSnapshot,
	type SessionParticipant,
} from "./api.ts";
import {
	formatAgo,
	formatDuration,
	formatLeftAgo,
	formatSessionStart,
	restTier,
	studyTier,
} from "./format.ts";
import ProfileDialog from "./ProfileDialog.tsx";
import StatusMessage from "./StatusMessage.tsx";
import StudyIcon from "./StudyIcon.tsx";
import ThemeToggle from "./ThemeToggle.tsx";
import Toast, { type ToastState, type ToastTone } from "./Toast.tsx";

const POLL_INTERVAL_MS = 5000;

/** 접속 중일 때 누적 시간에 따라 붙는 불꽃. 2단계부터 붙는다. */
const FLAME_LABEL = [
	"",
	"",
	"불이 붙음",
	"활활 타는 중",
	"파랗게 타는 중",
];

/** 나간 지 오래될수록 깊이 잠든다. 경계는 접속 쪽과 같은 1·3·5시간. */
const REST_LABEL = ["잠깐 자리 비움", "졸기 시작", "자는 중", "오늘은 끝"];

function Card({
	participant,
	now,
	onOpen,
}: {
	participant: SessionParticipant;
	now: number;
	onOpen: () => void;
}) {
	const seconds = participant.onlineSeconds;
	// 나갔다고 불꽃을 빼앗지 않는다. 머문 시간은 그대로 남아 있는 것이고,
	// 꺼진 느낌은 투명도로 낸다(.card--offline).
	const tier = studyTier(seconds);
	const rest = participant.isPresent ? 0 : restTier(participant.lastOccurredAt, now);

	// 입장을 놓친 사람은 실제로는 더 오래 있었을 수 있다. 아래로만 틀린다.
	const atLeast = participant.joinTimeUncertain && participant.isPresent;

	return (
		<li>
			{/* 타일 전체가 프로필 카드를 여는 버튼이다. 90px 안에 누를 것을
			    여럿 두면 서로 먹는다. */}
			<button
				type="button"
				className={
					participant.isPresent
						? `card card--tier${tier}`
						: "card card--offline"
				}
				onClick={onOpen}
			>
				<StudyIcon
					tier={tier}
					face="🧑‍💻"
					label={
						participant.isPresent
							? `공부 중${tier >= 2 ? `, ${FLAME_LABEL[tier]}` : ""}`
							: (REST_LABEL[rest] ?? "자리 비움")
					}
				/>

				<span className="card__name">
					{participant.displayName ?? "이름 없음"}
					{participant.isYou && <span className="card__me">(나)</span>}
				</span>

				<span
					className="card__time"
					title={
						atLeast
							? "서버가 입장 이벤트를 받지 못했습니다. 실제로는 이보다 깁니다"
							: undefined
					}
				>
					{participant.isPresent
						? `${formatDuration(seconds)}${atLeast ? "+" : ""}`
						: formatLeftAgo(participant.lastOccurredAt, now)}
				</span>

				<StatusMessage
					value={participant.statusMessage}
					dimmed={!participant.isPresent}
				/>
			</button>
		</li>
	);
}

/**
 * 오프라인 정렬.
 *
 * 서버는 머문 시간순으로 준다(아이콘이 그 시간으로 정해지므로 목록도 같은
 * 기준이어야 읽힌다). 다만 "방금 누가 나갔나" 를 보고 싶을 때가 있어서
 * 화면에서 고를 수 있게 둔다.
 */
type OfflineSort = "stay" | "left";

const OFFLINE_SORTS: { id: OfflineSort; label: string }[] = [
	{ id: "stay", label: "머문 시간순" },
	{ id: "left", label: "나간 순" },
];

function sortOffline(
	people: SessionParticipant[],
	by: OfflineSort,
): SessionParticipant[] {
	// 서버가 이미 머문 시간순으로 보냈다. 그대로 두면 된다.
	if (by === "stay") return people;

	return [...people].sort(
		(a, b) =>
			Date.parse(b.lastOccurredAt) - Date.parse(a.lastOccurredAt),
	);
}

function Section({
	title,
	tone,
	people,
	now,
	emptyText,
	onOpen,
	control,
}: {
	title: string;
	tone: "online" | "offline";
	people: SessionParticipant[];
	now: number;
	emptyText?: string;
	onOpen: (participant: SessionParticipant) => void;
	/** 제목 줄 오른쪽에 붙는 것. 지금은 오프라인 정렬 고르개다. */
	control?: ReactNode;
}) {
	if (people.length === 0 && !emptyText) {
		return null;
	}

	// section 으로 감싸지 않는다. sticky 는 제 부모 안에서만 붙어 있어서,
	// 구역마다 감싸면 구역이 끝날 때 제목이 자기 높이만큼 밀려 나가고 다음
	// 제목은 아직 도착하지 않아 아무 라벨도 없는 틈이 생긴다.
	// 제목들이 같은 부모(main)를 쓰면 다음 제목이 앞 제목을 덮으며 넘겨받는다.
	return (
		<>
			<h2 className={`section__title section__title--${tone}`}>
				<span className={`section__dot section__dot--${tone}`} aria-hidden="true" />
				{title}
				{control}
				<span className="section__count">{`${people.length}명`}</span>
			</h2>

			{people.length === 0 ? (
				<p className="section__empty">{emptyText}</p>
			) : (
				<ul className="grid">
					{people.map((p) => (
						<Card
							key={p.participantUuid}
							participant={p}
							now={now}
							onOpen={() => onOpen(p)}
						/>
					))}
				</ul>
			)}
		</>
	);
}

/** 말풍선에 공지를 한 줄씩 돌려 보여주는 주기(ms). */
const NOTICE_ROTATE_MS = 7000;

/**
 * 말풍선이 보여줄 순서를 정한다.
 *
 * `main` 을 **일반 몇 개마다 한 번씩** 끼운다. 그냥 앞에 붙이기만 하면 꿀팁이
 * 다섯 줄일 때 메인이 여섯 번에 한 번(42초에 한 번)만 나와 놓치기 쉽고,
 * 한 칸 걸러 끼우면 절반이 메인이라 과하다. 그 사이를 잡는다.
 *
 *     [메인, 꿀팁1, 꿀팁2, 꿀팁3, 메인, 꿀팁4, 꿀팁5]
 *
 * 메인이 여럿이면 그것들도 돌아가며 끼워진다. 한쪽이 비면 남은 쪽만 돈다.
 * 덮지는 않는다 — 오래 띄워 두는 공지 하나 때문에 꿀팁이 통째로 사라지는
 * 편이 더 나쁘다. 구분은 색으로 한다(`bubble--main`).
 */
/** 일반 공지 몇 개마다 메인을 한 번 끼울지. 올리면 메인이 드물어진다. */
const MAIN_EVERY = 3;

function pickNotices(notices: Notice[]): Notice[] {
	const main = notices.filter((n) => n.category === "main");
	const general = notices.filter((n) => n.category !== "main");

	if (main.length === 0) return general;
	if (general.length === 0) return main;

	const mixed: Notice[] = [];
	let inserted = 0;
	for (const [index, notice] of general.entries()) {
		if (index % MAIN_EVERY === 0) {
			// 메인이 하나뿐이면 매번 같은 것이 끼워진다 — 그래도 맞다
			const next = main[inserted % main.length];
			if (next) mixed.push(next);
			inserted += 1;
		}
		mixed.push(notice);
	}

	return mixed;
}

/**
 * 공지를 하나씩 돌린다.
 *
 * 여러 줄을 한꺼번에 쌓으면 머리글이 본문보다 커진다. 한 줄씩 돌리면
 * 자리도 적게 쓰고 눈에도 걸린다. 한 줄뿐이면 돌리지 않는다.
 */
function useRotatingNotice(notices: Notice[]): Notice | null {
	const [index, setIndex] = useState(0);

	useEffect(() => {
		if (notices.length <= 1) return;

		const timer = setInterval(() => {
			setIndex((i) => (i + 1) % notices.length);
		}, NOTICE_ROTATE_MS);

		return () => clearInterval(timer);
	}, [notices.length]);

	// 공지가 줄어들면 index 가 범위를 벗어날 수 있다
	return notices[index % Math.max(notices.length, 1)] ?? null;
}

// visibilityState 만 보면 안 된다 — 탭은 그대로 두고 다른 창으로 포커스만
// 옮겨도 여전히 visible 이라 폴링이 안 멈춘다. hasFocus 도 같이 봐야 한다.
function useIsWindowActive(): boolean {
	const isBrowser = typeof document !== "undefined";
	const [active, setActive] = useState(
		() => !isBrowser || (document.visibilityState === "visible" && document.hasFocus()),
	);

	useEffect(() => {
		if (!isBrowser) return;

		const update = () =>
			setActive(document.visibilityState === "visible" && document.hasFocus());

		document.addEventListener("visibilitychange", update);
		window.addEventListener("focus", update);
		window.addEventListener("blur", update);
		return () => {
			document.removeEventListener("visibilitychange", update);
			window.removeEventListener("focus", update);
			window.removeEventListener("blur", update);
		};
	}, []);

	return active;
}

export default function App() {
	// 경과 시간 표시를 1초마다 다시 그린다 (데이터 요청과 무관)
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);

	const queryClient = useQueryClient();
	const [toast, setToast] = useState<ToastState | null>(null);

	const showToast = useCallback((tone: ToastTone, message: string) => {
		setToast({ key: Date.now(), tone, message });
	}, []);

	const dismissToast = useCallback(() => setToast(null), []);

	const isWindowActive = useIsWindowActive();

	const { data, isPending, isError, isFetching } = useQuery({
		queryKey: ["presence"],
		queryFn: fetchPresence,
		// 안 보고 있을 땐 폴링을 꺼둔다. 돌아오면 refetchOnWindowFocus 가 알아서 갱신한다.
		refetchInterval: isWindowActive ? POLL_INTERVAL_MS : false,
		// 통신이 끊겨도 직전 목록을 유지한다.
		// 화면이 비면 전원 퇴장으로 오해된다.
		placeholderData: (previous) => previous,
	});

	// 공지는 자주 바뀌지 않는다. 길게 캐시하고 실패해도 조용히 넘어간다 —
	// 말풍선이 안 뜨는 것이 화면이 죽는 것보다 낫다.
	const noticeQuery = useQuery({
		queryKey: ["notices"],
		queryFn: fetchNotices,
		staleTime: 5 * 60 * 1000,
		retry: false,
	});
	const notice = useRotatingNotice(pickNotices(noticeQuery.data ?? []));

	// 오프라인 정렬 기준. 기본은 서버가 주는 머문 시간순이다.
	const [offlineSort, setOfflineSort] = useState<OfflineSort>("stay");

	const statusMutation = useMutation({
		mutationFn: ({ uuid, message }: { uuid: string; message: string }) =>
			saveStatusMessage(uuid, message),
		onError: (error) => {
			showToast(
				"error",
				error instanceof Error ? error.message : "상태 메시지를 저장하지 못했습니다",
			);
		},
		onSuccess: (saved, { uuid }) => {
			showToast("success", saved ? "상태 메시지를 저장했습니다" : "상태 메시지를 지웠습니다");
			// 다음 폴링을 기다리지 않고 바로 반영한다
			queryClient.setQueryData<PresenceSnapshot>(["presence"], (prev) =>
				prev
					? {
							...prev,
							participants: prev.participants.map((p) =>
								p.participantUuid === uuid ? { ...p, statusMessage: saved } : p,
							),
						}
					: prev,
			);
		},
	});

	async function handleSaveStatus(uuid: string, message: string) {
		await statusMutation.mutateAsync({ uuid, message });
	}

	// 열려 있는 프로필 카드. 목록이 5초마다 갱신되므로 uuid 로만 붙들고
	// 최신 데이터를 매번 다시 찾는다. 카드가 켜진 채로 시간이 흐른다.
	const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
	const setSelected = useCallback(
		(participant: SessionParticipant) => setSelectedUuid(participant.participantUuid),
		[],
	);
	const closeProfile = useCallback(() => setSelectedUuid(null), []);

	const updatedAt = data?.updatedAt ? Date.parse(data.updatedAt) : null;
	// 접속 중은 누적 시간이 많은 순. 값은 서버가 이미 끝까지 계산해 준다.
	const online = (data?.participants.filter((p) => p.isPresent) ?? [])
		.slice()
		.sort((a, b) => b.onlineSeconds - a.onlineSeconds);
	// 나간 사람은 서버가 머문 시간순으로 준다. 화면에서 기준을 바꿀 수 있다.
	const offlineRaw = data?.participants.filter((p) => !p.isPresent) ?? [];
	const offline = useMemo(
		() => sortOffline(offlineRaw, offlineSort),
		// 목록이 같으면 다시 정렬하지 않는다
		[offlineRaw, offlineSort],
	);
	const loading = isPending && !data;

	// 값이 없으면 빈 문자열이 와서 아래 렌더가 통째로 빠진다.
	const sessionStart = formatSessionStart(data?.startedAt ?? null);

	const selected =
		data?.participants.find((p) => p.participantUuid === selectedUuid) ?? null;

	return (
		<main className="screen">
			<Toast toast={toast} onDismiss={dismissToast} />

			{selected && (
				<ProfileDialog
					participant={selected}
					now={now}
					onSave={(message) =>
						handleSaveStatus(selected.participantUuid, message)
					}
					onClose={closeProfile}
				/>
			)}

			{isError && data && (
				<div className="banner" role="status">
					연결 끊김 · 마지막 정보를 보여주는 중
				</div>
			)}

			<div className="topbar">
				<div className="topbar__meta">
					{sessionStart && (
						<p className="topbar__started">
							{/* 시작 시각을 못 받아 추정한 경우에는 회의 시작이라고
							    단정하지 않는다. 실제 시작은 이보다 이르다. */}
							{`${data?.startedAtEstimated ? "기록 시작" : "회의 시작"}: ${sessionStart}`}
							{data?.openedBy && (
								<span className="topbar__opener">{`${data.openedBy} start~`}</span>
							)}
						</p>
					)}
					<p className="topbar__total">
						{loading || (data?.totalCount ?? 0) === 0
							? " "
							: `누적 ${data?.totalCount}명`}
						{/* 봇은 사람 목록에 없다. 붙어 있다는 사실만 여기 알린다 */}
						{data?.bot?.isPresent && (
							<span className="topbar__bot" title={`${data.bot.name} 접속 중`}>
								<span className="topbar__bot-dot" aria-hidden="true" />
								봇 구동 중
							</span>
						)}
					</p>
				</div>
				{/* topbar 가 space-between 이라 묶지 않으면 둘이 양끝으로 벌어진다 */}
				<div className="topbar__actions">
					{/* 테마 버튼과 같은 모양. 누르면 통계로 간다 */}
					<a
						className="theme-toggle"
						href="/stats"
						aria-label="통계 보기"
						title="통계 보기"
					>
						<span aria-hidden="true">📊</span>
					</a>
					<ThemeToggle />
				</div>
			</div>

			<header className="header">
				<div className="header__left">
					<p className="header__label">접속 중</p>
					<p className="header__count">
						{loading ? (
							<span className="header__placeholder">—</span>
						) : (
							<>
								{data?.count ?? 0}
								<span className="header__unit">명</span>
							</>
						)}
					</p>
					<p className="header__meta">
						{isError && !data ? "불러오지 못했습니다" : formatAgo(updatedAt, now)}
						{isFetching && <span className="header__dot" aria-hidden="true" />}
					</p>
				</div>

				<div className="header__right">
					{data?.host && (
						<p className="host">
							<span className="host__label">현재 호스트</span>
							<span className="host__name">{data.host.displayName}</span>
							{/* 역할 이벤트가 없어 문 연 사람으로 물러선 경우다. 단정하지 않는다 */}
							{data.host.source === "opener" && (
								<span
									className="host__guess"
									title="역할 변경 기록이 없어 문을 연 사람으로 추정한 값입니다"
								>
									추정
								</span>
							)}
						</p>
					)}
					{/* 공지는 말풍선 하나에 한 줄씩 돌아간다 */}
					{notice && (
						<p
							className={
								notice.category === "main" ? "bubble bubble--main" : "bubble"
							}
							key={notice.id}
						>
							{notice.body}
						</p>
					)}
				</div>
			</header>

			{loading ? (
				<p className="empty">불러오는 중…</p>
			) : (
				<>
					<Section
						title="온라인"
						tone="online"
						people={online}
						now={now}
						emptyText="접속 중인 사람이 없습니다"
						onOpen={setSelected}
					/>
					<Section
						title="오프라인"
						tone="offline"
						people={offline}
						now={now}
						onOpen={setSelected}
						control={
							offline.length > 1 ? (
								<span className="section__sort">
									{OFFLINE_SORTS.map((option) => (
										<button
											key={option.id}
											type="button"
											className={
												offlineSort === option.id
													? "section__sortOption section__sortOption--on"
													: "section__sortOption"
											}
											aria-pressed={offlineSort === option.id}
											onClick={() => setOfflineSort(option.id)}
										>
											{option.label}
										</button>
									))}
								</span>
							) : undefined
						}
					/>
				</>
			)}
		</main>
	);
}
