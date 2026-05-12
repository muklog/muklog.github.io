import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/**
 * Google Play 등록정보 — 계정·데이터 삭제 요청 URL용.
 * (앱/서비스명, 절차, 삭제·보관 데이터 유형을 한 페이지에 명시)
 */
export default function DeleteAccountGuidePage() {
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
          <h1 className="text-lg font-bold text-slate-100">계정 및 데이터 삭제 안내</h1>
          <p className="text-xs text-slate-500">Account &amp; data deletion</p>
        </div>
      </header>

      <section
        className="rounded-xl border border-brand-500/30 bg-brand-500/5 p-4 text-sm leading-relaxed text-slate-300"
        aria-labelledby="intro-heading"
      >
        <h2 id="intro-heading" className="text-base font-semibold text-brand-200">
          서비스 및 앱 이름
        </h2>
        <p className="mt-2">
          <strong className="text-slate-100">먹로그 (Muklog)</strong> — 식단·건강 기록 웹 앱 및 동일
          서비스의 Android(TWA) 앱입니다.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          <span className="text-slate-400">English:</span> This page describes how to request deletion of
          your Muklog service data and related cloud copies. It is shown from the Google Play store listing
          for the Muklog app.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">삭제 요청 절차 (눈에 띄는 안내)</h2>
        <ol className="list-inside list-decimal space-y-2 text-slate-400 marker:text-slate-500">
          <li>
            <span className="text-slate-300">앱 또는 웹</span>에서 Muklog(먹로그)를 엽니다. 웹 주소:{" "}
            <a
              href="https://muklog.github.io/"
              className="text-brand-400 underline"
              target="_blank"
              rel="noreferrer"
            >
              https://muklog.github.io/
            </a>
          </li>
          <li>
            Google로 로그인한 경우, 하단 <strong className="text-slate-200">설정</strong> 탭으로 이동합니다.
          </li>
          <li>
            설정 화면에서 <strong className="text-slate-200">&quot;모든 데이터 삭제&quot;</strong>를 누르고
            안내에 따라 확인합니다. 이 작업은 이 기기의 로컬 데이터와, 동기화를 켠 경우 클라우드에 저장된 본인
            서비스 데이터 삭제를 요청합니다.
          </li>
          <li>
            삭제 후 세션을 끝내려면 설정에서 <strong className="text-slate-200">로그아웃</strong>을 할 수
            있습니다.
          </li>
        </ol>
        <p className="text-xs text-slate-500">
          <span className="text-slate-400">English — steps:</span> Open Muklog → go to{" "}
          <strong className="text-slate-300">Settings</strong> (bottom tab) → tap{" "}
          <strong className="text-slate-300">&quot;모든 데이터 삭제&quot; (Delete all data)</strong> and
          confirm → optionally <strong className="text-slate-300">Log out</strong>.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">삭제되거나 보관되는 데이터</h2>
        <p>
          <strong className="text-slate-100">&quot;모든 데이터 삭제&quot;</strong>를 완료하면, 서비스가
          관리하는 범위에서 다음에 해당하는 정보의 삭제가 진행됩니다: 식단 기록(사진·텍스트·댓글·좋아요 등),
          건강 기록, 프로필·친구 관계·공유·초대·알림 등 동기화·소셜 기능과 연관된 Firestore 데이터, 해당
          사용자 미디어 저장소(Storage) 내 본인 콘텐츠, 이 기기의 로컬(IndexedDB) 데이터.
        </p>
        <p className="text-slate-400">
          삭제는 네트워크·동기화 지연에 따라 반영까지 시간이 걸릴 수 있습니다. Google Firebase·Google 계정
          인프라에 남을 수 있는 최소한의 운영·보안 로그는 Google 정책에 따릅니다.
        </p>
        <p className="text-xs text-slate-500">
          <span className="text-slate-400">English:</span> Full wipe removes your Muklog app data from this
          device and requests deletion of your synced Firestore documents and linked Storage media for this
          app. Propagation may take a short time. Residual logs on Google infrastructure follow Google&apos;s
          policies.
        </p>
        <p>
          <strong className="text-slate-100">Google 계정 자체</strong>는 Muklog에서 삭제하지 않습니다. Google
          계정 연결 해제·앱 권한 철회는{" "}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
            className="text-brand-400 underline"
          >
            Google 계정 보안 설정
          </a>
          에서 진행할 수 있습니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">계정을 유지한 채 일부 데이터만 삭제</h2>
        <p>
          <strong className="text-slate-100">예.</strong> 로그인 상태에서 타임라인·달력 등에서 개별 식단
          기록을 삭제할 수 있으며, 설정의 &quot;모든 데이터 삭제&quot; 없이도 부분 삭제가 가능합니다.
        </p>
        <p className="text-xs text-slate-500">
          <span className="text-slate-400">English:</span> You may delete individual meals or other records
          in the app without using the full &quot;delete all data&quot; option.
        </p>
      </section>

      <p className="text-center text-xs text-slate-600">
        <Link to="/data-deletion" className="text-brand-400 underline">
          데이터만 삭제 안내
        </Link>
        {" · "}
        <Link to="/privacy" className="text-brand-400 underline">
          개인정보 처리방침
        </Link>
        {" · "}
        <Link to="/settings" className="text-brand-400 underline">
          설정
        </Link>
      </p>
    </div>
  );
}
