import { Component } from 'react'
import { WarningCircle, ArrowClockwise } from '@phosphor-icons/react'

// A render error anywhere in the POS used to blank the whole screen with no
// explanation, which is the worst possible failure in a shop: staff cannot tell
// whether the till is broken or the app is. This catches it, shows what broke,
// and offers a way back without a machine restart.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Cake City POS crashed:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-cream">
        <div className="max-w-md w-full text-center flex flex-col items-center gap-4">
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-50 text-red-600 ring-1 ring-red-200">
            <WarningCircle weight="light" className="w-6 h-6" />
          </span>
          <div>
            <h1 className="font-serif text-lg font-semibold text-espresso">Kituimekatwa</h1>
            <p className="text-sm text-espresso-muted/70 mt-1">
              Programu ilisimama kwa sababu ya hitilafu. Data yako iko salama.
            </p>
          </div>
          <pre className="w-full text-left text-[10px] leading-relaxed bg-espresso/[0.04] text-espresso-muted rounded-lg px-3 py-2 max-h-32 overflow-auto ring-1 ring-hairline">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload() }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-espresso text-cream text-xs font-semibold transition-all duration-300 active:scale-95"
          >
            <ArrowClockwise weight="bold" className="w-3.5 h-3.5" />
            Anza upya
          </button>
        </div>
      </div>
    )
  }
}
