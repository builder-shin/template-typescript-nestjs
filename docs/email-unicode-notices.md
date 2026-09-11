# Email Unicode data

The generated email Unicode profile freezes the reference runtime: CPython Unicode Character Database 15.1.0 and Python idna 3.13 IDNA validity data 17.0.0. Runtime upgrades must not silently change account identity or acceptance.

The profile stores Unicode safety categories, combining marks, bidirectional classes, and IDNA2008 PVALID ranges. RFC 5892 ContextO and RFC 5893 bidi checks run in the email helper. Nest uses tr46 6.0.0 for UTS46 conversion; Rails uses simpleidn 0.2.3 only for Punycode encoding/decoding; UTS46 mapping comes from the frozen reference table because the released gem has older mappings. Both reject invalid labels explicitly. Both preserve NFC and full casefold identity. Conversion never checks DNS.

To refresh the profile, run `scripts/generate-email-unicode.py` in Python 3.13 with `idna==3.13`. Review changed fixtures against the reference EmailStr behavior and run all auth/email/migration tests before accepting a new Unicode version. Normalization changes require a new collision-preflight migration; do not rewrite a published migration.

Unicode Character Database data are used under the Unicode data license: https://www.unicode.org/license.txt . Python idna data are used under the following license.

BSD 3-Clause License

Copyright (c) 2013-2026, Kim Davies and contributors.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
