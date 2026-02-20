# SVG Scorecard Implementation Summary

## Overview
Re-implemented the SVG scorecard system with **class-aware metrics** that displays on student README files.

## Key Changes

### 1. New Class-Aware SVG Template
**File**: `OSS-Doorway/src/templates/class-template.svg`

Features:
- **Class Name** in header
- **Two Progress Dials**:
  - Your Progress (0-100%)
  - Class Rank (percentile with color coding)
- **Quest Information**:
  - Current Quest ID and Title
  - Task completion (e.g., "3/7 complete")
- **Class Metrics**:
  - Class average completion percentage
- **Personal Stats**:
  - Points and XP
  - Data collected count (from `storedValues`)
  - Completed quests with badges
- **Dynamic Height**: Adjusts based on number of completed quests

### 2. Helper Functions Added
**Location**: `OSS-Doorway/src/gamification.js` (lines ~1616-1713)

#### `fetchClassData(classId)`
- Fetches all students in a class from OSS-Management backend
- Returns array of student data with completion percentages

#### `calculateClassPercentile(userCompletion, classStudents)`
- Calculates user's rank within the class
- Returns percentile, display text, and color:
  - **Gold** (#FFD700): Top 10%
  - **Orange** (#FFA500): Top 25%
  - **Blue** (#2f80ed): Top 50%
  - **Green** (#00C853): Below 50%

#### `calculateClassAverage(classStudents)`
- Computes average completion % across all class students

#### `getCurrentQuestInfo(user_data, questConfig)`
- Extracts current quest details:
  - Quest ID
  - Quest title (truncated if >30 chars)
  - Task progress (e.g., "3/7")

### 3. SVG Generation Functions

#### `generateSVG(owner, repo, context, user_data, db, classId)`
- **Router function** that decides which SVG to generate
- If `customGroupId` exists → Class-aware SVG
- Otherwise → Legacy individual SVG

#### `generateClassAwareSVG(owner, repo, context, user_data, db, classId)`
- Generates new class-based scorecard
- Fetches class data from management backend
- Calculates class metrics
- Saves to `userCards/{username}-scorecard-{timestamp}.svg`

#### `generateLegacySVG(owner, repo, context, user_data, db)`
- Original implementation preserved
- Fallback for users without class association
- Saves to `userCards/draft-{timestamp}.svg`

### 4. README Update Integration
**Location**: `OSS-Doorway/src/gamification.js` - `updateReadme()` function

Key Features:
- ✅ **Conditional SVG**: Only generates for repos starting with `"misanetc"`
- ✅ **Auto-includes**: Embeds SVG image in README progress section
- ✅ **Graceful fallback**: Continues without SVG if generation fails

```javascript
// Only for repos starting with "misanetc"
const shouldIncludeSVG = repo.toLowerCase().startsWith('misanetc');

if (shouldIncludeSVG) {
  const classId = user_data?.customGroupId;
  newSVG = await generateSVG(owner, repo, context, user_data, db, classId);
}

// Dynamic section includes SVG
if (newSVG) {
  dynamicSection += `![Quest Progress Scorecard](/${newSVG}?)\n\n`;
}
```

## Data Flow

```
Task Completion Event
  ↓
updateReadme() called
  ↓
Check: repo.startsWith('misanetc')?
  ↓ YES
Get user's customGroupId
  ↓
generateSVG() → Router
  ↓
Has customGroupId?
  ├─ YES → generateClassAwareSVG()
  │         ├─ Fetch class students from backend
  │         ├─ Calculate percentile & class avg
  │         ├─ Get current quest info
  │         ├─ Populate class-template.svg
  │         └─ Save to repo
  │
  └─ NO → generateLegacySVG()
            └─ Use original template.svg
  ↓
Embed SVG in README
  ↓
Commit README update
```

## Environment Requirements

- `MANAGEMENT_BASE_URL`: URL to OSS-Management backend
  - Default: `https://oss-michael-production.up.railway.app`
- Backend must have endpoints:
  - `GET /api/group/:classId/students`
  - `GET /api/group/:classId`

## Testing Checklist

### Scenario 1: misanetc repo with class
- [x] Repo starts with "misanetc"
- [x] User has `customGroupId`
- [x] **Expected**: Class-aware SVG generated and shown

### Scenario 2: misanetc repo without class
- [x] Repo starts with "misanetc"
- [x] User has NO `customGroupId`
- [x] **Expected**: Legacy SVG generated and shown

### Scenario 3: Non-misanetc repo
- [x] Repo does NOT start with "misanetc"
- [x] **Expected**: NO SVG generated, text-only progress

### Scenario 4: Backend unavailable
- [x] Management backend is down
- [x] **Expected**: Falls back to N/A for class metrics, still generates SVG

## Color Coding Reference

| Percentile | Display | Color | Meaning |
|-----------|---------|-------|---------|
| ≥ 90% | "Top 10%" | Gold | Exceptional |
| ≥ 75% | "Top 25%" | Orange | Excellent |
| ≥ 50% | "Top 50%" | Blue | Good |
| < 50% | "50%" | Green | Making Progress |

## File Structure

```
OSS-Doorway/
├── src/
│   ├── gamification.js                      # Main implementation
│   └── templates/
│       ├── template.svg                     # Legacy individual SVG
│       └── class-template.svg               # NEW: Class-aware SVG
└── SVG_SCORECARD_IMPLEMENTATION.md          # This file
```

## Benefits

1. **Educational Context**: Students see their progress relative to class
2. **Privacy-Conscious**: Only shows percentiles, not raw scores
3. **Motivational**: Color-coded ranks encourage progress
4. **Flexible**: Auto-detects class membership
5. **Backwards Compatible**: Works for non-class users
6. **Targeted Rollout**: Only enabled for "misanetc" repos

## Future Enhancements

- Cache class data for 5 minutes to reduce backend calls
- Add cleanup script to remove old scorecard SVGs
- Support custom themes per class
- Add "quest milestone" badges for major achievements
- Show trend arrows (↑ improved, ↓ declined, → stable)

## Maintenance Notes

- SVG files are never deleted (accumulate over time)
- Each update creates a new timestamped file
- GitHub caches SVGs aggressively (query param `?` helps bust cache)
- Class data is fetched on every README update (consider caching)

---

## Recent Fixes

### October 19, 2025
1. **Fixed Octokit API Path**: Changed from `context.octokit.repos` to `context.octokit.rest.repos`
2. **Fixed Class ID Extraction**: Now correctly extracts base class ID from suffixed IDs
   - Example: `68a770b8140b9c0174c13ce7_purple_1760378826454` → `68a770b8140b9c0174c13ce7`
   - Fixes 404 errors when fetching class data from management backend
3. **Improved Image URL Format**: Using full GitHub raw URL with timestamp cache-busting
4. **Enhanced Error Handling**: Added timeout protection and better fallback behavior

---

**Implementation Date**: October 2025  
**Developer**: AI Assistant  
**Status**: ✅ Complete and Tested

