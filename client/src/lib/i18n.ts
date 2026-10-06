export interface Translations {
  // Navigation & General
  managementChanges: string;
  assistantTitle: string;
  languageToggle: string;
  roleSwitcher: string;
  machineAssistedNotice: string;
  
  // Tabs
  tabLeave: string;
  tabEvents: string;
  tabIntake: string;
  tabReallocation: string;
  tabHistory: string;

  // Actions
  previewImpact: string;
  confirmChange: string;
  discardChange: string;
  revertChange: string;
  submitting: string;
  clearChat: string;
  send: string;
  typeMessagePlaceholder: string;

  // Form Fields
  staffMember: string;
  startDate: string;
  endDate: string;
  reason: string;
  eventName: string;
  date: string;
  startPeriod: string;
  endPeriod: string;
  venueRoom: string;
  targetSection: string;
  newIntakeSize: string;

  // Results & Summaries
  affectedSessions: string;
  clashesCount: string;
  shortfallBefore: string;
  shortfallAfter: string;
  substituteSuggestions: string;
  unresolvedIssues: string;
  diffSummary: string;
  historyLog: string;
  whatIfSimulation: string;
  confirmNeededHint: string;
  noHistory: string;
}

export const I18N_STRINGS: Record<'en' | 'ta', Translations> = {
  en: {
    managementChanges: 'Management Changes & Re-solve',
    assistantTitle: 'Smart Timetable Assistant',
    languageToggle: 'தமிழ் (Tamil)',
    roleSwitcher: 'Active Role',
    machineAssistedNotice: 'Tamil translations are machine-assisted. Please verify domain terms.',
    
    tabLeave: 'Faculty Leave',
    tabEvents: 'Events & Rooms',
    tabIntake: 'Intake Rebalance',
    tabReallocation: 'Teacher Reallocation',
    tabHistory: 'Change History',

    previewImpact: 'Preview Impact',
    confirmChange: 'Confirm & Apply to Timetable',
    discardChange: 'Discard Preview',
    revertChange: 'Revert Change',
    submitting: 'Processing...',
    clearChat: 'Clear Conversation',
    send: 'Send',
    typeMessagePlaceholder: 'Ask in English or தமிழில் கேளுங்கள்...',

    staffMember: 'Faculty Member',
    startDate: 'Start Date',
    endDate: 'End Date',
    reason: 'Reason / Purpose',
    eventName: 'Event Name',
    date: 'Date',
    startPeriod: 'Start Period',
    endPeriod: 'End Period',
    venueRoom: 'Venue Room',
    targetSection: 'Target Section',
    newIntakeSize: 'New Section Size (Students)',

    affectedSessions: 'Affected Sessions',
    clashesCount: 'New Clashes',
    shortfallBefore: 'Shortfall Before',
    shortfallAfter: 'Shortfall After',
    substituteSuggestions: 'Substitute Teacher Recommendations',
    unresolvedIssues: 'Unresolved Displacements',
    diffSummary: 'Side-by-Side Schedule Diff',
    historyLog: 'Applied Management Changes Log',
    whatIfSimulation: 'Hypothetical What-if Simulation',
    confirmNeededHint: 'Note: AI actions only generate previews. Click "Confirm & Apply" to write changes to live timetable.',
    noHistory: 'No applied changes yet recorded in history.',
  },
  ta: {
    managementChanges: 'நிர்வாக மாற்றங்கள் மற்றும் அட்டவணை தீர்வு',
    assistantTitle: 'ஸ்மார்ட் கால அட்டவணை உதவியாளர்',
    languageToggle: 'English',
    roleSwitcher: 'பயனர் நிலை',
    machineAssistedNotice: 'குறிப்பு: தமிழ் சொற்கள் இயந்திர உதவி மூலம் வழங்கப்பட்டுள்ளன.',
    
    tabLeave: 'ஆசிரியர் விடுப்பு',
    tabEvents: 'நிகழ்வுகள் & அரங்கங்கள்',
    tabIntake: 'மாணவர் சேர்க்கை மாற்றம்',
    tabReallocation: 'ஆசிரியர் மறுபகிர்வு',
    tabHistory: 'மாற்றங்களின் வரலாறு',

    previewImpact: 'தாக்கத்தை முன்னோட்டமிடு',
    confirmChange: 'உறுதிசெய்து அட்டவணையில் சேர்',
    discardChange: 'முன்னோட்டத்தை ரத்துசெய்',
    revertChange: 'முந்தைய நிலைக்குத் திருப்பு',
    submitting: 'செயலாக்கப்படுகிறது...',
    clearChat: 'உரையாடலை அழி',
    send: 'அனுப்பு',
    typeMessagePlaceholder: 'தமிழிலோ ஆங்கிலத்திலோ கேள்வி கேளுங்கள்...',

    staffMember: 'ஆசிரியர் பெயர்',
    startDate: 'தொடக்க தேதி',
    endDate: 'முடிவு தேதி',
    reason: 'காரணம் / விவரம்',
    eventName: 'நிகழ்வின் பெயர்',
    date: 'தேதி',
    startPeriod: 'தொடக்க பீரியட்',
    endPeriod: 'முடிவு பீரியட்',
    venueRoom: 'நிகழ்வு நடைபெறும் அறை',
    targetSection: 'வகுப்புப் பிரிவு',
    newIntakeSize: 'புதிய பிரிவு அளவு (மாணவர்கள் எண்ணிக்கை)',

    affectedSessions: 'பாதிக்கப்பட்ட வகுப்புகள்',
    clashesCount: 'புதிய முரண்பாடுகள் (Clashes)',
    shortfallBefore: 'முந்தைய பற்றாக்குறை',
    shortfallAfter: 'தற்போதைய பற்றாக்குறை',
    substituteSuggestions: 'மாற்று ஆசிரியர் பரிந்துரைகள்',
    unresolvedIssues: 'தீர்க்கப்படாத வகுப்புகள்',
    diffSummary: 'முந்தைய vs புதிய அட்டவணை ஒப்பீடு',
    historyLog: 'செயல்படுத்தப்பட்ட மாற்றங்களின் வரலாறு',
    whatIfSimulation: 'மாதிரி (What-if) உருவகப்படுத்துதல்',
    confirmNeededHint: 'குறிப்பு: AI தானாக அட்டவணையை மாற்றாது. அட்டவணையில் செயல்படுத்த கீழே உள்ள "உறுதிசெய்க" பொத்தானை அழுத்தவும்.',
    noHistory: 'இதுவரை எந்த மாற்றமும் வரலாற்றில் பதிவு செய்யப்படவில்லை.',
  },
};
