import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/**
 * Google Play 등록정보 — 「계정 없이 데이터 일부·전체 삭제」 제공 시
 * 요구되는 데이터 삭제 요청 안내 URL용.
 */
export default function DataDeletionGuidePage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-5 px-4 pt-4 pb-28">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-lg p-2 hover:bg-slate-800"
          aria-label="뒤로"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <p className="text-xs text-slate-400">Muklog · 먹로그</p>
          <h1 className="text-lg font-bold text-slate-100">데이터 삭제 요청 안내</h1>
          <p className="text-xs text-slate-500">Request deletion of your data (without closing your account)</p>
        </div>
      </header>

      <section
        className="rounded-xl border border-brand-500/30 bg-brand-500/5 p-4 text-sm leading-relaxed text-slate-300"
        aria-labelledby="app-name-heading"
      >
        <h2 id="app-name-heading" className="text-base font-semibold text-brand-200">
          앱·서비스 이름
        </h2>
        <p className="mt-2">
          <strong className="text-slate-100">먹로그 (Muklog)</strong> — 식단·건강 기록 웹 앱 및 동일 서비스의
          Android(TWA) 앱입니다. 아래는 <strong className="text-slate-100">Google 로그인을 유지한 채</strong>{" "}
          서비스 데이터의 일부 또는 전체 삭제를 요청하는 방법입니다.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          <span className="text-slate-400">English:</span> This page explains how to delete some or all of
          your Muklog data while keeping your Google sign-in, as referenced from the Google Play store listing.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">1. 일부 데이터만 삭제 (계정 유지)</h2>
        <p className="rounded-lg border border-slate-700/80 bg-slate-900/40 p-3 text-slate-200">
          앱에서 피드·달력·날짜 상세 화면 등으로 이동한 뒤, 삭제할 <strong>개별 식단·기록</strong>의 메뉴에서
          삭제를 선택합니다. 로그아웃하거나 Google 계정을 끊지 않아도 됩니다.
        </p>
        <ol className="list-inside list-decimal space-y-2 text-slate-400 marker:text-slate-500">
          <li>
            <span className="text-slate-300">Muklog(먹로그)</span>를 엽니다.
          </li>
          <li>
            삭제할 기록이 있는 <strong className="text-slate-200">날짜·피드 항목</strong>으로 이동합니다.
          </li>
          <li>
            해당 기록의 <strong className="text-slate-200">더보기·메뉴</strong>에서 삭제를 선택하고 확인합니다.
          </li>
        </ol>
        <p className="text-xs text-slate-500">
          <span className="text-slate-400">English:</span> Open a meal or record → use its menu →{" "}
          <strong className="text-slate-300">Delete</strong>. Repeat for other items. Your Google account stays
          linked until you remove it in Google settings.
        </p>
        <p className="text-slate-400">
          개별 삭제 시 해당 식단·첨부·댓글 등 그 기록에 묶인 서비스 데이터가 삭제됩니다. 동기화를 사용 중이면
          클라우드에 있는 동일 기록도 삭제 요청이 반영됩니다. 반영까지 짧은 지연이 있을 수 있습니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">2. 서비스 데이터 전체 삭제 (계정·Google 로그인 유지)</h2>
        <p className="rounded-lg border border-slate-700/80 bg-slate-900/40 p-3 text-slate-200">
          계정을 없애지 않고, 이 앱이 보관하는 <strong>데이터만 한꺼번에</strong> 지우려면 설정의{" "}
          <strong>&quot;모든 데이터 삭제&quot;</strong>를 사용합니다.
        </p>
        <ol className="list-inside list-decimal space-y-2 text-slate-400 marker:text-slate-500">
          <li>
            하단 <strong className="text-slate-200">설정</strong> 탭으로 이동합니다.
          </li>
          <li>
            <strong className="text-slate-200">&quot;모든 데이터 삭제&quot;</strong>를 누르고 안내에 따라
            확인합니다.
          </li>
        </ol>
        <p className="text-xs text-slate-500">
          <span className="text-slate-400">English:</span>{" "}
          <strong className="text-slate-300">Settings</strong> →{" "}
          <strong className="text-slate-300">&quot;모든 데이터 삭제&quot; (Delete all data)</strong> → confirm.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">삭제·보관되는 데이터 유형 및 기간</h2>
        <ul className="list-inside list-disc space-y-2 text-slate-400 marker:text-slate-500">
          <li>
            <span className="text-slate-300">개별 삭제:</span> 선택한 기록과 그에 수반되는 앱 내·동기화된
            해당 항목 데이터.
          </li>
          <li>
            <span className="text-slate-300">모든 데이터 삭제:</span> 식단·건강·프로필·친구·공유·초대·알림 등
            서비스가 관리하는 Firestore·Storage·이 기기 로컬(IndexedDB)의 본인 데이터 삭제가 진행됩니다.
          </li>
          <li>
            <span className="text-slate-300">보관·잔여:</span> Muklog는 위 절차 완료 후 사용자 콘텐츠를 별도
            장기 보관하지 않습니다. 삭제 반영은 네트워크·동기화 때문에 지연될 수 있으며, Google
            Firebase·Google 계정 인프라에 남을 수 있는 최소한의 운영·보안 로그는{" "}
            <a
              href="https://firebase.google.com/support/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-brand-400 underline"
            >
              Google 정책
            </a>
            에 따릅니다. Google 계정 자체의 삭제는 Google 계정 설정에서 별도로 진행합니다.
          </li>
        </ul>
      </section>

      <p className="text-center text-xs text-slate-600">
        <Link to="/delete-account" className="text-brand-400 underline">
          계정 및 관련 데이터 삭제 안내
        </Link>
        {" · "}
        <Link to="/privacy" className="text-brand-400 underline">
          개인정보 처리방침
        </Link>
      </p>
    </div>
  );
}
