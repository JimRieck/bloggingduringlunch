import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import './StarRating.css'

export function StarRating({ postId, session }) {
  const [summary, setSummary] = useState(null)
  const [myRating, setMyRating] = useState(null)
  const [hoverValue, setHoverValue] = useState(0)

  useEffect(() => {
    supabase
      .from('post_rating_summary')
      .select('average_rating, rating_count')
      .eq('post_id', postId)
      .maybeSingle()
      .then(({ data }) => setSummary(data ?? { average_rating: 0, rating_count: 0 }))
  }, [postId])

  useEffect(() => {
    if (!session) {
      setMyRating(null)
      return
    }
    supabase
      .from('post_ratings')
      .select('rating')
      .eq('post_id', postId)
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setMyRating(data?.rating ?? null))
  }, [postId, session])

  async function rate(value) {
    if (!session) return
    const { error } = await supabase
      .from('post_ratings')
      .upsert({ post_id: postId, user_id: session.user.id, rating: value }, { onConflict: 'post_id,user_id' })
    if (error) return
    const previous = myRating
    setMyRating(value)
    // Keep the public average in sync without a full refetch.
    setSummary((s) => {
      if (!s) return s
      if (previous) {
        const total = s.average_rating * s.rating_count - previous + value
        return { ...s, average_rating: Math.round((total / s.rating_count) * 10) / 10 }
      }
      const count = s.rating_count + 1
      const total = s.average_rating * s.rating_count + value
      return { average_rating: Math.round((total / count) * 10) / 10, rating_count: count }
    })
  }

  if (!summary) return null

  const displayValue = hoverValue || myRating || Math.round(summary.average_rating)

  return (
    <div className="star-rating">
      <div className="star-rating-stars" onMouseLeave={() => setHoverValue(0)}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            className={value <= displayValue ? 'filled' : ''}
            disabled={!session}
            title={session ? `Rate ${value} star${value > 1 ? 's' : ''}` : 'Log in to rate this post'}
            onMouseEnter={() => session && setHoverValue(value)}
            onClick={() => rate(value)}
          >
            ★
          </button>
        ))}
      </div>
      <span className="star-rating-summary">
        {summary.rating_count > 0
          ? `${summary.average_rating} (${summary.rating_count} rating${summary.rating_count === 1 ? '' : 's'})`
          : 'No ratings yet'}
      </span>
    </div>
  )
}
