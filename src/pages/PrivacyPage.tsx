import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/**
 * 플레이 스토어·웹 공통 — 개인정보 처리방침 고지 URL용.
 * (의료기기·진단 서비스가 아님을 함께 안내)
 */
export default function PrivacyPage() {
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
          <p className="text-xs text-slate-400">법적 고지</p>
          <h1 className="text-lg font-bold">개인정보 처리방침 · 서비스 안내</h1>
        </div>
      </header>

      <p className="text-xs text-slate-500">
        시행일: 2026년 5월 8일 · 서비스명: 먹로그(muklog)
      </p>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">1. 총칙</h2>
        <p>
          먹로그(이하 &quot;서비스&quot;)는 식단·건강 기록을 남기고, 선택적으로 Google 계정을 통해 데이터를
          동기화하며, 사용자가 직접 설정한 Google Gemini API 키로 AI 분석을 수행할 수 있는 웹 앱입니다.
          본 방침은 서비스 이용 과정에서 처리될 수 있는 정보와 제3자 서비스 연동을 설명합니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">2. 수집·생성되는 정보</h2>
        <ul className="list-inside list-disc space-y-2 text-slate-400 marker:text-slate-500">
          <li>
            <span className="text-slate-300">기기·브라우저 로컬(IndexedDB)</span> — 프로필(닉네임·아바타
            등), 식단 사진·텍스트, 건강기록, 앱 설정(테마, Gemini 키 등), 친구·팔로우 관계와 관련 메타데이터 등
            이용 중 생성되는 데이터.
          </li>
          <li>
            <span className="text-slate-300">Google 로그인(Firebase Authentication)</span> 이용 시 — 계정
            식별에 필요한 정보(예: 이메일, 표시 이름, 프로필 이미지 URL 등 Firebase가 제공하는 범위).
          </li>
          <li>
            <span className="text-slate-300">동기화·소셜 기능(Firestore)</span> — 로그인 후 사용자가
            동기화·공유를 사용할 때, 팔로우·초대·댓글·알림 등 서비스 운영에 필요한 데이터가 Google 클라우드
            인프라에 저장될 수 있습니다.
          </li>
          <li>
            <span className="text-slate-300">AI 분석(Google Generative AI / Gemini)</span> — 사용자가 설정에
            저장한 API 키로, 사용자가 선택한 식사·건강 관련 이미지·텍스트가 Google의 생성형 AI 서비스로
            전송되어 분석됩니다. 키와 요청은 사용자 기기에서 발신되는 구조이며, Google의 AI·API 약관 및 개인정보
            정책이 추가로 적용될 수 있습니다.
          </li>
        </ul>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">3. 이용 목적</h2>
        <ul className="list-inside list-disc space-y-2 text-slate-400 marker:text-slate-500">
          <li>식단·건강 기록 기능 및 사용자 인터페이스 제공</li>
          <li>계정·데이터 동기화, 친구 피드·댓글·알림 등 소셜 기능 제공</li>
          <li>사용자 요청에 따른 AI 기반 요약·추정 정보 제공(참고용)</li>
          <li>보안·남용 방지, 오류 분석을 위한 최소한의 기술적 기록(해당 시)</li>
        </ul>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">4. 제3자 제공·위탁</h2>
        <p>
          서비스는{" "}
          <a
            href="https://firebase.google.com/support/privacy"
            target="_blank"
            rel="noreferrer"
            className="text-brand-400 underline"
          >
            Google Firebase
          </a>
          및{" "}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noreferrer"
            className="text-brand-400 underline"
          >
            Google
          </a>
          의 클라우드·인증·(선택 시) AI API를 이용합니다. 해당 사업자의 개인정보 처리방침이 병행 적용됩니다.
          그 외 사용자가 별도로 연동하는 서비스는 해당 서비스의 정책을 따릅니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">5. 보관·삭제</h2>
        <p>
          로컬 데이터는 브라우저 저장소 정책에 따릅니다. 클라우드 동기화 데이터는 Firestore에 보관되며,
          사용자는 앱 내 기능(예: 설정의 &quot;모든 데이터 삭제&quot;, 개별 기록 삭제)을 통해 삭제를 요청할 수
          있습니다. 삭제는 기술·동기화 지연에 따라 완전히 반영되기까지 시간이 걸릴 수 있습니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">6. 이용자 권리</h2>
        <p>
          사용자는 설정에서 로그아웃·데이터 삭제, 프로필·기록의 열람·수정·삭제를 수행할 수 있습니다. 법령상
          권리 행사가 필요한 경우 관할 법에 따른 절차를 안내받을 수 있습니다.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-amber-200">7. AI·건강 정보 관련 안내(중요)</h2>
        <p>
          서비스가 제공하는 AI 분석·점수·코멘트는 <strong className="text-slate-100">참고용 웰니스 정보</strong>
          이며, 의료기기·의학적 진단·치료·처방을 대체하지 않습니다. 신체 증상이 있거나 치료가 필요하다면 반드시
          의료 전문가와 상담하세요.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">8. 문의</h2>
        <p className="text-slate-400">
          본 방침에 관한 문의는 서비스를 제공하는 운영 주체가 지정한 연락처(예: 공식 이메일, 저장소 이슈
          트래커)를 통해 접수할 수 있습니다. 연락처는 배포 페이지 또는 저장소 README에 안내될 수 있습니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">9. 방침의 변경</h2>
        <p className="text-slate-400">
          법령·서비스 변경에 따라 본 방침을 수정할 수 있으며, 중요한 변경 시 서비스 내 공지 등 합리적인 방법으로
          안내합니다.
        </p>
      </section>

      <p className="text-center text-xs text-slate-600">
        <Link to="/settings" className="text-brand-400 underline">
          설정으로 돌아가기
        </Link>
      </p>
    </div>
  );
}
