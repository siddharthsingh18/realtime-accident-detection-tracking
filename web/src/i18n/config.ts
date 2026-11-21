import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  en: {
    translation: {
      app_title: "Incident Command Console",
      app_subtitle: "Autonomous Vision Surveillance • BoT-SORT Motion Tracking • Dual YOLOv8 Verification",
      disclaimer: "Automated detections are unverified and not for emergency dispatch.",
      nav: {
        live_wall: "Live Wall",
        focus_view: "Focus View",
        review_queue: "Review Queue",
        analytics: "Analytics",
        compare: "A/B Compare",
        cameras: "Camera Setup",
        settings: "Settings",
      },
      status: {
        idle: "Idle",
        connecting: "Connecting",
        live: "Live Stream",
        paused: "Paused",
        completed: "Completed",
        error: "Stream Error",
        mock: "MOCK DATA",
      },
      alert: {
        normal: "SYSTEM NORMAL: ROAD SURVEILLANCE ACTIVE",
        critical: "CRITICAL ALERT: ACCIDENT CONFIRMED",
        action_required: "ACTION REQUIRED",
        toast_confirmed: "Accident Confirmed",
        open: "Open",
        mark_false_alarm: "Mark False Alarm",
        snooze: "Snooze 5 min",
      },
      kpi: {
        confirmed_accidents: "Confirmed Accidents",
        tracked_vehicles: "Tracked Vehicles",
        inference_fps: "Inference FPS",
        frame_progress: "Frame Progress",
      },
      review: {
        title: "Incident Review Queue",
        verdict: "Verdict",
        true_accident: "True Accident",
        false_alarm: "False Alarm",
        unsure: "Unsure",
        unreviewed: "Unreviewed",
        bulk_actions: "Bulk Actions",
        export_csv: "Export CSV",
        caveat: "Verdicts are operator opinions and are used only for counts on the Analytics page.",
      },
      analytics: {
        title: "Incident Analytics",
        operator_outcomes: "Operator-Reviewed Outcomes",
        caveat: "Based only on incidents an operator reviewed. Missed accidents are not counted and are not measurable here.",
        insufficient_data: "Fewer than 20 operator reviews recorded. Counts shown for review volume only.",
      },
      compare: {
        title: "A/B Pipeline Comparison",
        subtitle: "Side-by-side execution of two configurations on identical footage. Raw numbers only.",
        caveat: "Raw counts and frame ranges only. No precision/recall or model accuracy score is inferred.",
      },
    },
  },
  hi: {
    translation: {
      app_title: "दुर्घटना नियंत्रण कंसोल",
      app_subtitle: "स्वचालित दृष्टि निगरानी • BoT-SORT गति ट्रैकिंग • दोहरा YOLOv8 सत्यापन",
      disclaimer: "स्वचालित पहचान असत्यापित हैं और आपातकालीन प्रेषण के लिए नहीं हैं।",
      nav: {
        live_wall: "लाइव वॉल",
        focus_view: "फोकस दृश्य",
        review_queue: "समीक्षा कतार",
        analytics: "विश्लेषण",
        compare: "ए/बी तुलना",
        cameras: "कैमरा सेटअप",
        settings: "सेटिंग्स",
      },
      status: {
        idle: "निष्क्रिय",
        connecting: "कनेक्ट हो रहा है",
        live: "लाइव स्ट्रीम",
        paused: "विराम",
        completed: "पूर्ण",
        error: "स्ट्रीम त्रुटि",
        mock: "मॉक डेटा",
      },
      alert: {
        normal: "सिस्टम सामान्य: सड़क निगरानी सक्रिय",
        critical: "गंभीर चेतावनी: दुर्घटना की पुष्टि",
        action_required: "कार्रवाई आवश्यक",
        toast_confirmed: "दुर्घटना की पुष्टि हुई",
        open: "खोलें",
        mark_false_alarm: "गलत अलार्म चिह्नित करें",
        snooze: "5 मिनट स्नूज़",
      },
      kpi: {
        confirmed_accidents: "पुष्ट दुर्घटनाएं",
        tracked_vehicles: "ट्रैक किए गए वाहन",
        inference_fps: "इनफरेंस एफपीएस",
        frame_progress: "फ्रेम प्रगति",
      },
      review: {
        title: "दुर्घटना समीक्षा कतार",
        verdict: "निर्णय",
        true_accident: "वास्तविक दुर्घटना",
        false_alarm: "झूठा अलार्म",
        unsure: "अनिश्चित",
        unreviewed: "असमीक्षित",
        bulk_actions: "थोक कार्रवाइयां",
        export_csv: "सीएसवी निर्यात",
        caveat: "निर्णय ऑपरेटर की राय हैं और केवल विश्लेषण पृष्ठ पर गणना के लिए उपयोग किए जाते हैं।",
      },
      analytics: {
        title: "घटना विश्लेषण",
        operator_outcomes: "ऑपरेटर-समीक्षित परिणाम",
        caveat: "केवल उन्हीं घटनाओं पर आधारित जिनकी ऑपरेटर द्वारा समीक्षा की गई है। छूटी हुई दुर्घटनाओं की गणना नहीं की जाती है।",
        insufficient_data: "20 से कम ऑपरेटर समीक्षाएं दर्ज की गईं।",
      },
      compare: {
        title: "ए/बी पाइपलाइन तुलना",
        subtitle: "समान फुटेज पर दो कॉन्फ़िगरेशन का साथ-साथ निष्पादन। केवल कच्चे आंकड़े।",
        caveat: "केवल कच्ची संख्याएं और फ्रेम रेंज। कोई सटीकता स्कोर नहीं निकाला गया है।",
      },
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;

