"use client";

import { useState } from "react";
import { Send, CheckCircle2, Loader2, AlertCircle } from "lucide-react";

export default function Contact() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !subject || !message) {
      setError("Please fill out all required fields.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      // Simulate API submit delay (placeholder for real submit endpoint)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      setSuccess(true);
      setName("");
      setEmail("");
      setSubject("");
      setMessage("");
    } catch (err) {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative isolate py-12 md:py-20">
      {/* Decorative gradient flare */}
      <div className="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-brand-purple/5 blur-[150px] rounded-full pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="max-w-3xl mx-auto text-center mb-16 space-y-4">
          <span className="text-xs font-bold text-brand-cyan uppercase tracking-widest">Get in Touch</span>
          <h1 className="text-4xl font-extrabold text-white tracking-tight sm:text-5xl">
            Contact Support & Authors
          </h1>
          <p className="text-lg text-slate-400">
            Have questions about self-hosting or enterprise security deployment? Reach out directly.
          </p>
        </div>

        <div className="max-w-xl mx-auto">
          {success ? (
            <div className="glass-panel p-8 rounded-2xl border border-brand-emerald/20 bg-brand-emerald/5 text-center space-y-6">
              <CheckCircle2 className="h-16 w-16 text-brand-emerald mx-auto animate-bounce" />
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-white">Message Sent Successfully!</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Thank you for reaching out. The AMPHub maintenance team at IT Support BD will review your inquiry and get back to you shortly.
                </p>
              </div>
              <button
                onClick={() => setSuccess(false)}
                className="inline-flex justify-center py-2.5 px-6 border border-white/10 rounded-xl text-xs font-semibold text-white bg-white/5 hover:bg-white/10 transition-all"
              >
                Send Another Message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="glass-panel p-6 sm:p-8 rounded-2xl border border-white/5 space-y-6 text-left relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-brand-purple/5 blur-2xl rounded-full"></div>

              {/* Error Alert */}
              {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Inputs */}
              <div className="space-y-4">
                {/* Name */}
                <div className="space-y-1.5">
                  <label htmlFor="name" className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                    Your Name <span className="text-brand-cyan">*</span>
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your name"
                    required
                    className="w-full bg-[#05060b] border border-white/5 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-cyan/40 transition-colors"
                  />
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                    Email Address <span className="text-brand-cyan">*</span>
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    className="w-full bg-[#05060b] border border-white/5 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-cyan/40 transition-colors"
                  />
                </div>

                {/* Subject */}
                <div className="space-y-1.5">
                  <label htmlFor="subject" className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                    Subject <span className="text-brand-cyan">*</span>
                  </label>
                  <input
                    type="text"
                    id="subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Inquiry subject"
                    required
                    className="w-full bg-[#05060b] border border-white/5 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-cyan/40 transition-colors"
                  />
                </div>

                {/* Message */}
                <div className="space-y-1.5">
                  <label htmlFor="message" className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                    Inquiry Details <span className="text-brand-cyan">*</span>
                  </label>
                  <textarea
                    id="message"
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="How can we help you self-host or manage your AMPHub connections?"
                    required
                    className="w-full bg-[#05060b] border border-white/5 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-cyan/40 transition-colors resize-none"
                  ></textarea>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-black bg-brand-cyan hover:bg-brand-cyan/90 transition-all disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Submitting Request...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" /> Send Message
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
