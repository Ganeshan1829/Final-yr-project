import { TOOL_DEFINITIONS, executeToolAsync, sanitizeDataText, UserContext, ToolExecutionResult } from './tools.js';

export interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_call?: any;
  tool_result?: any;
  created_at?: string;
}

export interface ChatResponse {
  reply: string;
  tool_call?: {
    name: string;
    arguments: any;
  };
  tool_result?: any;
  preview?: any;
  is_what_if?: boolean;
  language: 'en' | 'ta';
  configured: boolean;
}

// Check if string contains Tamil characters
export function isTamilText(text: string): boolean {
  return /[\u0B80-\u0BFF]/.test(text);
}

// Convert common day names to approximate date in semester for mock tests if needed
function resolveDateForQuery(query: string): string {
  const dateMatch = query.match(/\b(202[5-9]-\d{2}-\d{2})\b/);
  if (dateMatch) return dateMatch[1];
  // Default to first week of semester
  return '2026-08-04';
}

/**
 * Deterministic Mock LLM Provider
 * Maps natural language intents to tools with typed arguments,
 * extracts parameters, handles Tamil/English, and generates factual replies.
 */
function runMockLLM(
  userMessage: string,
  _history: ChatMessage[],
  userCtx: UserContext
): { toolName?: string; toolArgs?: any; reply?: string } {
  const lower = userMessage.toLowerCase();

  // 0. Teacher-aware allocation intents (checked first: "leave"/"students" keywords below would otherwise match)
  const staffIds = (userMessage.match(/\b(STF\d+)\b/gi) || []).map((x) => x.toUpperCase());
  const subjectMatch = (userMessage.match(/\b([A-Z]{2,5}-?\d{2,4}[A-Z]?)\b/g) || []).find((c) => !/^STF/i.test(c));
  const mentionsRedistribution =
    lower.includes('redistribut') || lower.includes('reallocat') || lower.includes('reassign') || lower.includes('மறுபகிர்வு');
  if (mentionsRedistribution && staffIds.length > 0) {
    const dates = userMessage.match(/\b(202[5-9]-\d{2}-\d{2})\b/g);
    const stage = /\b(stage|propose|prepare|draft|apply)\b/.test(lower);
    return {
      toolName: 'simulate_teacher_allocation',
      toolArgs: {
        unavailable_staff_ids: staffIds,
        ...(subjectMatch ? { subject_codes: [subjectMatch.toUpperCase()] } : {}),
        ...(dates ? { effective_date: dates[0] } : {}),
        reason: 'Chatbot reallocation request',
        stage,
      },
    };
  }
  if (subjectMatch && (lower.includes('distribut') || lower.includes('split') || lower.includes('how many students') || lower.includes('பகிர்'))) {
    return {
      toolName: 'suggest_student_distribution',
      toolArgs: { subject_code: subjectMatch.toUpperCase(), ...(staffIds.length ? { unavailable_staff_ids: staffIds } : {}) },
    };
  }
  if ((lower.includes('predict') || lower.includes('forecast')) && (lower.includes('class size') || lower.includes('class demand') || lower.includes('student demand'))) {
    return { toolName: 'predict_class_demand', toolArgs: subjectMatch ? { subject_codes: [subjectMatch.toUpperCase()] } : {} };
  }

  // 1. Find free rooms: "Which rooms are free on Tuesday period 3?" / "Free rooms now" / "அறை" (room)
  if (
    lower.includes('free room') ||
    lower.includes('rooms are free') ||
    lower.includes('empty room') ||
    lower.includes('காலியான அறை')
  ) {
    const periodMatch = lower.match(/period\s*(\d+)/i) || lower.match(/பீரியட்\s*(\d+)/i);
    const period = periodMatch ? parseInt(periodMatch[1], 10) : 3;
    const date = resolveDateForQuery(userMessage);

    let room_type: 'lecture' | 'lab' | 'any' = 'any';
    if (lower.includes('lab') || lower.includes('ஆய்வகம்')) room_type = 'lab';
    else if (lower.includes('lecture') || lower.includes('வகுப்பறை')) room_type = 'lecture';

    return {
      toolName: 'find_free_rooms',
      toolArgs: {
        date,
        period,
        room_type,
      },
    };
  }

  // 2. Who is free: "Who is free Tuesday period 3?" / "get_staff_free_slots" / "faculty free"
  if (
    (lower.includes('who is free') || lower.includes('staff free') || lower.includes('faculty free') || lower.includes('யார் ஓய்வு')) &&
    !lower.includes('leave')
  ) {
    const staffMatch = userMessage.match(/\b(STF\d+)\b/i);
    const staffId = staffMatch ? staffMatch[1].toUpperCase() : (userCtx.role === 'staff' ? userCtx.userId : 'STF001');
    const date = resolveDateForQuery(userMessage);

    return {
      toolName: 'get_staff_free_slots',
      toolArgs: {
        staff_id: staffId,
        date,
      },
    };
  }

  // 3. Hours left: "Hours left for Data Structures" / "Hours left for CS301" / "மீதமுள்ள மணிநேரம்"
  if (
    lower.includes('hours left') ||
    lower.includes('shortfall') ||
    lower.includes('required hours') ||
    lower.includes('மணிநேரம்')
  ) {
    const codeMatch = userMessage.match(/\b([A-Z]{2,4}\d{3})\b/i);
    return {
      toolName: 'get_hours_left',
      toolArgs: {
        subject_code: codeMatch ? codeMatch[1].toUpperCase() : undefined,
      },
    };
  }

  // 4. "What if": "What if Staff STF001 is on leave next week?" / "What if section CS301-A has 40 students?"
  if (lower.includes('what if') || lower.includes('what-if') || lower.includes('ஒருவேளை')) {
    if (lower.includes('leave') || lower.includes('விடுப்பு')) {
      const staffMatch = userMessage.match(/\b(STF\d+)\b/i);
      const staffId = staffMatch ? staffMatch[1].toUpperCase() : 'STF001';
      return {
        toolName: 'preview_what_if',
        toolArgs: {
          type: 'leave',
          payload: {
            staff_id: staffId,
            start_date: '2026-08-10',
            end_date: '2026-08-14',
            reason: 'What-if Simulation Leave',
          },
        },
      };
    } else if (lower.includes('intake') || lower.includes('students') || lower.includes('மாணவர்கள்')) {
      const sizeMatch = lower.match(/\b(\d{2,3})\b/);
      const secMatch = userMessage.match(/\b([A-Z0-9]+-[A-Z])\b/i);
      return {
        toolName: 'preview_what_if',
        toolArgs: {
          type: 'intake',
          payload: {
            section_id: secMatch ? secMatch[1] : 'CS301-A',
            new_size: sizeMatch ? parseInt(sizeMatch[1], 10) : 40,
          },
        },
      };
    }
  }

  // 5. Preview Leave: "Mark STF001 on leave from 2026-08-10 to 2026-08-14"
  if (lower.includes('leave') || lower.includes('விடுப்பு')) {
    if (lower.includes('list') || lower.includes('பட்டியல்')) {
      return {
        toolName: 'list_leave',
        toolArgs: {},
      };
    }
    const staffMatch = userMessage.match(/\b(STF\d+)\b/i);
    const staffId = staffMatch ? staffMatch[1].toUpperCase() : (userCtx.role === 'staff' ? userCtx.userId : 'STF001');
    const dates = userMessage.match(/\b(202[5-9]-\d{2}-\d{2})\b/g) || ['2026-08-10', '2026-08-14'];
    return {
      toolName: 'preview_add_leave',
      toolArgs: {
        staff_id: staffId,
        start_date: dates[0],
        end_date: dates[1] || dates[0],
        reason: 'Staff leave request',
      },
    };
  }

  // 6. Preview Event: "Add event Workshop on 2026-08-20 period 1 to 4 in LH1"
  if (lower.includes('event') || lower.includes('நிகழ்வு') || lower.includes('seminar') || lower.includes('workshop')) {
    if (lower.includes('list') || lower.includes('பட்டியல்')) {
      return {
        toolName: 'list_events',
        toolArgs: {},
      };
    }
    const roomMatch = userMessage.match(/\b(LH\d+|LAB\d+|HALL\d+|R\d+)\b/i);
    return {
      toolName: 'preview_add_event',
      toolArgs: {
        name: 'Technical Workshop',
        date: resolveDateForQuery(userMessage),
        start_period: 2,
        end_period: 4,
        venue_room_id: roomMatch ? roomMatch[1].toUpperCase() : 'LH1',
      },
    };
  }

  // 7. Preview Intake change: "Change intake of CS301-A to 40"
  if (lower.includes('intake') || lower.includes('resize') || lower.includes('மாணவர் சேர்க்கை')) {
    const sizeMatch = lower.match(/\b(\d{2,3})\b/);
    const secMatch = userMessage.match(/\b([A-Z0-9]+-[A-Z])\b/i);
    return {
      toolName: 'preview_change_intake',
      toolArgs: {
        section_id: secMatch ? secMatch[1] : 'CS301-A',
        new_size: sizeMatch ? parseInt(sizeMatch[1], 10) : 40,
      },
    };
  }

  // 8. Timetable insights: "insights" / "utilization" / "பகுப்பாய்வு"
  if (lower.includes('insight') || lower.includes('utilization') || lower.includes('wasted') || lower.includes('பகுப்பாய்வு')) {
    return {
      toolName: 'insights',
      toolArgs: {},
    };
  }

  // 9. Timetable inspection: "get_timetable" / "schedule" / "வகுப்பு அட்டவணை"
  if (lower.includes('timetable') || lower.includes('schedule') || lower.includes('அட்டவணை')) {
    if (lower.includes('export') || lower.includes('download')) {
      return {
        toolName: 'export_request',
        toolArgs: { kind: 'timetable' },
      };
    }
    const secMatch = userMessage.match(/\b([A-Z0-9]+-[A-Z])\b/i);
    const staffMatch = userMessage.match(/\b(STF\d+)\b/i);
    if (secMatch) {
      return {
        toolName: 'get_timetable',
        toolArgs: { scope: 'section', value: secMatch[1] },
      };
    } else if (staffMatch) {
      return {
        toolName: 'get_timetable',
        toolArgs: { scope: 'staff', value: staffMatch[1].toUpperCase() },
      };
    } else {
      return {
        toolName: 'get_timetable',
        toolArgs: { scope: 'day', value: resolveDateForQuery(userMessage) },
      };
    }
  }

  // 10. Holidays list: "holidays" / "விடுமுறை"
  if (lower.includes('holiday') || lower.includes('விடுமுறை')) {
    return {
      toolName: 'list_holidays',
      toolArgs: {},
    };
  }

  // Default conversational greeting or helpful prompt
  if (isTamilText(userMessage)) {
    return {
      reply: 'வணக்கம்! நான் உங்கள் ஸ்மார்ட் கால அட்டவணை உதவியாளர். காலியான அறைகள், ஆசிரியர்களின் ஓய்வு நேரம், பாட மணிநேரங்கள் அல்லது மாற்றங்களின் மாதிரியை (What-if) அறிய என்னிடம் கேளுங்கள்.',
    };
  }

  return {
    reply: 'Hello! I am your Smart Timetable Assistant. I can help you check free rooms, faculty free periods, subject hours left, insights, and preview management changes (leave, events, intake). How can I assist you today?',
  };
}

/**
 * Format factual, deterministic replies from tool outputs in English or Tamil.
 * Never invents numbers or facts not in toolResult.
 */
function formatToolResponseText(
  toolName: string,
  result: any,
  isTamil: boolean
): string {
  if (isTamil) {
    switch (toolName) {
      case 'find_free_rooms':
        return `தேதி ${result.date} மற்றும் பீரியட் ${result.period_range} இல் மொத்தம் ${result.total_free} காலியான அறைகள் உள்ளன: ${result.rooms.map((r: any) => `${r.name} (${r.capacity} இருக்கைகள், ${r.type})`).join(', ') || 'எந்த அறையும் கிடைக்கவில்லை'}.`;
      case 'get_staff_free_slots':
        return `ஆசிரியர் ${result.staff_id} அவர்களுக்கு தேதி ${result.date} இல் இலவச பீரியட்கள்: ${result.free_periods.join(', ') || 'எதுவுமில்லை'}. திட்டமிடப்பட்ட பீரியட்கள்: ${result.busy_periods.join(', ') || 'எதுவுமில்லை'}.`;
      case 'get_hours_left':
        return `பாடங்களுக்கான மணிநேர நிலவரம்: ${result.hours.map((h: any) => `${h.subject_code} (${h.section_label}): தேவைப்படும் மணிநேரம் ${h.required_hours}, திட்டமிடப்பட்டது ${h.delivered_hours}, பற்றாக்குறை ${h.shortfall_hours}`).join('; ')}`;
      case 'list_holidays':
        return `விடுமுறை நாட்கள் பட்டியல்: ${result.holidays.map((h: any) => `${h.date}: ${h.name}`).join(', ') || 'விடுமுறை இல்லை'}.`;
      case 'list_events':
        return `நிகழ்வுகள் பட்டியல்: ${result.events.map((e: any) => `${e.date} (பீரியட் ${e.start_period}-${e.end_period}): ${e.name} [அறை: ${e.venue_room_id}]`).join('; ') || 'நிகழ்வுகள் எதுவும் இல்லை'}.`;
      case 'export_request':
        return `கோப்பு பதிவிறக்கம் தயாராக உள்ளது: ${result.download_url}`;
      case 'predict_class_demand':
        return `வகுப்பு அளவு பரிந்துரைகள் புதுப்பிக்கப்பட்டன (${result.stored} கணிப்புகள்). இவை ஆலோசனை மட்டுமே; இறுதி முடிவை ஒதுக்கீட்டு இயந்திரம் எடுக்கும்.`;
      case 'suggest_student_distribution':
        return `${result.subject_code} பாடத்திற்கான பரிந்துரைக்கப்பட்ட மாணவர் பகிர்வு (${result.total_students} மாணவர்கள்): ${result.teachers.map((t: any) => `${t.staff_name || t.staff_id} -> ${t.students}`).join('; ')}. எதுவும் மாற்றப்படவில்லை.`;
      case 'insights':
        return `கால அட்டவணை பகுப்பாய்வு: குறைந்த பயன்பாட்டு அறைகள்: ${result.underused_rooms.length}, வீணாகும் இருக்கைகள் உள்ள வகுப்புகள்: ${result.wasted_seat_allocations.length}, பற்றாக்குறை அபாயம் உள்ள பாடங்கள்: ${result.shortfall_risks.length}.`;
      default:
        return 'கோரிக்கை வெற்றிகரமாக செயலாக்கப்பட்டது.';
    }
  }

  // English formatting
  switch (toolName) {
    case 'find_free_rooms':
      return `Found ${result.total_free} free rooms on ${result.date} for period range ${result.period_range}: ${result.rooms.map((r: any) => `${r.name} (Cap: ${r.capacity}, ${r.type})`).join(', ') || 'None available'}.`;
    case 'get_staff_free_slots':
      return `Faculty ${result.staff_id} on ${result.date} is free during periods: ${result.free_periods.join(', ') || 'None'}. (Busy periods: ${result.busy_periods.join(', ') || 'None'}).`;
    case 'get_hours_left':
      return `Hours summary: ${result.hours.map((h: any) => `${h.subject_code} (${h.section_label}): Required ${h.required_hours}h, Delivered ${h.delivered_hours}h, Shortfall ${h.shortfall_hours}h`).join(' | ')}`;
    case 'list_holidays':
      return `Calendar holidays (${result.count}): ${result.holidays.map((h: any) => `${h.date} - ${h.name}`).join(', ') || 'No holidays found'}.`;
    case 'list_events':
      return `Scheduled events (${result.count}): ${result.events.map((e: any) => `${e.date} (Periods ${e.start_period}-${e.end_period}) - ${e.name} in room ${e.venue_room_id}`).join(' | ') || 'No events found'}.`;
    case 'export_request':
      return `Your export is ready. You can download it directly here: [${result.kind} CSV](${result.download_url})`;
    case 'predict_class_demand':
      return `ML class-size recommendations refreshed (batch ${result.batch_id}, model ${result.model}): ${result.stored} teacher/subject predictions stored. These are advisory targets only; teacher maximums and room capacity are still enforced by the allocation engine.`;
    case 'suggest_student_distribution':
      return `Suggested distribution for ${result.subject_code} (${result.total_students} students, room capacity ${result.room_capacity}): ${result.teachers.map((t: any) => `${t.staff_name || t.staff_id} -> ${t.students} (preferred ${t.preferred}, max ${t.max}${t.ml_expected != null ? `, ML ${Math.round(t.ml_expected)}` : ''})`).join('; ')}.${result.unallocated > 0 ? ` ${result.unallocated} student(s) could not be placed within limits.` : ''}${result.ml_note ? ` Note: ${result.ml_note}` : ''} Read-only; nothing was changed.`;
    case 'insights':
      return `Timetable Insights Summary: Found ${result.underused_rooms.length} underutilized rooms (<40%), ${result.wasted_seat_allocations.length} section-room allocations with large wasted seat margins, and ${result.shortfall_risks.length} subjects at risk of shortfall.`;
    default:
      return 'Operation completed successfully.';
  }
}

/**
 * Main Chat Processing Pipeline
 */
export async function processChatMessage(
  message: string,
  history: ChatMessage[],
  userCtx: UserContext
): Promise<ChatResponse> {
  const provider = (process.env.LLM_PROVIDER || 'mock').toLowerCase();
  const apiKey = process.env.LLM_API_KEY;
  const isTamil = isTamilText(message);

  // If a commercial provider is specified without an API key, notify the user cleanly
  if (provider !== 'mock' && !apiKey) {
    return {
      reply: isTamil
        ? 'உதவியாளர் இன்னும் கட்டமைக்கப்படவில்லை (API Key கிடைக்கவில்லை).'
        : 'Assistant not configured. Set LLM_API_KEY and LLM_PROVIDER in your environment.',
      language: isTamil ? 'ta' : 'en',
      configured: false,
    };
  }

  // Sanitize user message against prompt injection
  const cleanMessage = sanitizeDataText(message);

  // 1. Intent / Tool calling via Provider (Mock or API)
  let toolCallName: string | undefined;
  let toolCallArgs: any;
  let directReply: string | undefined;

  if (provider === 'mock') {
    const mockRes = runMockLLM(cleanMessage, history, userCtx);
    toolCallName = mockRes.toolName;
    toolCallArgs = mockRes.toolArgs;
    directReply = mockRes.reply;
  } else {
    // For live providers (e.g. Gemini / OpenAI), if configured:
    // Fallback to mock logic if network/API fails or in mock test mode
    try {
      // In production with live API keys, provider client would be invoked here.
      // Here we utilize the mock pattern matcher which conforms exactly to tools.
      const mockRes = runMockLLM(cleanMessage, history, userCtx);
      toolCallName = mockRes.toolName;
      toolCallArgs = mockRes.toolArgs;
      directReply = mockRes.reply;
    } catch (err: any) {
      directReply = `LLM call error: ${err.message}`;
    }
  }

  // If no tool was called, return direct conversational reply
  if (!toolCallName) {
    return {
      reply: directReply || (isTamil ? 'தங்கள் கேள்விக்கு விடை தயாராக இல்லை.' : 'I could not understand that request.'),
      language: isTamil ? 'ta' : 'en',
      configured: true,
    };
  }

  // 2. Validate and execute deterministic tool
  const toolResult: ToolExecutionResult = await executeToolAsync(toolCallName, toolCallArgs, userCtx);

  // Handle permission denial
  if (toolResult.denied) {
    return {
      reply: isTamil
        ? `அனுமதி மறுக்கப்பட்டது: உங்கள் பயனர் நிலைக்கு (${userCtx.role}) இந்த தகவலை அணுக அனுமதி இல்லை.`
        : (toolResult.message || 'Permission denied for this action.'),
      tool_call: { name: toolCallName, arguments: toolCallArgs },
      language: isTamil ? 'ta' : 'en',
      configured: true,
    };
  }

  // Handle tool failure / validation error
  if (!toolResult.success) {
    return {
      reply: isTamil
        ? `கோரிக்கை நிறைவேற்றப்படவில்லை: ${toolResult.message}`
        : (toolResult.message || 'Tool execution encountered an error.'),
      tool_call: { name: toolCallName, arguments: toolCallArgs },
      language: isTamil ? 'ta' : 'en',
      configured: true,
    };
  }

  // 3. For preview/action tools, format preview reply and attach preview payload
  if (toolResult.preview) {
    const preview = toolResult.preview;
    const isWhatIf = Boolean(toolResult.isWhatIf);

    let replyText = '';
    const realloc = preview.impact_summary?.reallocation;
    if (realloc) {
      const moved = realloc.moves.length;
      const stuck = realloc.unresolved.length;
      replyText = isTamil
        ? `${isWhatIf ? 'மாதிரி' : 'முன்னோட்டம்'}: ${moved} மாணவர்கள் மாற்றப்படுவார்கள்; ${stuck} மாணவர்களுக்கு இடம் கிடைக்கவில்லை. ${isWhatIf ? 'எதுவும் மாற்றப்படவில்லை.' : 'உறுதி செய்ய "Confirm" அழுத்தவும்.'}`
        : `${isWhatIf ? 'What-if reallocation' : 'Reallocation preview'}: ${moved} student(s) would move to other teachers' sections; ${stuck} could not be placed within teacher/room limits.${isWhatIf ? ' Nothing was changed.' : ' Review the moves and click Confirm to apply; nothing changes until the HOD confirms.'}`;
    } else if (isTamil) {
      replyText = isWhatIf
        ? `மாதிரி (What-if) பகுப்பாய்வு முடிந்தது. பாதிக்கப்பட்ட வகுப்புகள்: ${preview.impact_summary.sessions_affected_count}. இந்த மாதிரி மட்டுமே; கால அட்டவணையில் சேர்க்கப்படாது.`
        : `மாற்றத்தின் மாதிரி முன்னோட்டம் (Preview) உருவாக்கப்பட்டது. பாதிக்கப்பட்ட வகுப்புகள்: ${preview.impact_summary.sessions_affected_count}. இதை கால அட்டவணையில் உறுதி செய்ய கீழே உள்ள "Confirm" பொத்தானை அழுத்தவும்.`;
    } else {
      replyText = isWhatIf
        ? `What-if Simulation complete. Affected sessions: ${preview.impact_summary.sessions_affected_count}. This is a hypothetical simulation only and cannot be confirmed.`
        : `Preview generated successfully. Affected sessions: ${preview.impact_summary.sessions_affected_count}, Clashes: ${preview.impact_summary.clashes_count}. Please review the diff and click the Confirm button below to apply.`;
    }

    return {
      reply: replyText,
      tool_call: { name: toolCallName, arguments: toolCallArgs },
      tool_result: preview.impact_summary,
      preview,
      is_what_if: isWhatIf,
      language: isTamil ? 'ta' : 'en',
      configured: true,
    };
  }

  // 4. For read-only tools, synthesize response purely from tool result
  const factualReply = formatToolResponseText(toolCallName, toolResult.result, isTamil);

  return {
    reply: factualReply,
    tool_call: { name: toolCallName, arguments: toolCallArgs },
    tool_result: toolResult.result,
    language: isTamil ? 'ta' : 'en',
    configured: true,
  };
}
