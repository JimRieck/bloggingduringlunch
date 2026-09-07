import { Component } from 'react'
import './ErrorBoundary.css'

// Without this, an uncaught error anywhere in the render tree blanks the
// whole screen (React's default behavior) with nothing visible to the user
// and nothing but a console stack trace to go on. This catches that and
// shows something recoverable instead.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled error in render tree:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div id="error-boundary">
          <h1>Something went wrong</h1>
          <p>This page hit an unexpected error. Reloading usually fixes it.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
