import { groupSlotsByDay } from '../lib/randomSchedule.js'
import './RandomSlotList.css'

// A random schedule's posts, day by day: each with its time and the blog
// post it will share. Used for the review before saving
// (RandomSchedulePlanner) and for a saved schedule's "Coming up"
// (ScheduleTimeline). `slots` is [{ runAt, title }], in time order;
// `timeZone` is the schedule's own.
export function RandomSlotList({ slots, timeZone, label }) {
  const days = groupSlotsByDay(slots, timeZone)
  return (
    <div className="random-slot-list" role="region" aria-label={label} tabIndex={0}>
      {days.map((day) => (
        <section key={day.key} className="random-slot-day">
          <h5>{day.label}</h5>
          <ol>
            {day.slots.map((slot) => (
              <li key={new Date(slot.runAt).getTime()}>
                <time dateTime={new Date(slot.runAt).toISOString()}>{slot.time}</time>
                <span className="random-slot-title">{slot.title}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
